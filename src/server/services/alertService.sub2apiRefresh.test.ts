import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectGetMock = vi.fn();
const insertValuesMock = vi.fn();
const updateSetMock = vi.fn();
const notifyMock = vi.fn();
const runtimeHealthMock = vi.fn();
const refreshSub2ApiManagedSessionMock = vi.fn();

vi.mock('../db/index.js', () => {
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    get: () => selectGetMock(),
  };

  const insertChain = {
    values: (...args: unknown[]) => {
      insertValuesMock(...args);
      return insertChain;
    },
    run: () => ({}),
  };

  const updateChain = {
    set: (updates: Record<string, unknown>) => {
      updateSetMock(updates);
      return updateChain;
    },
    where: () => updateChain,
    run: () => ({}),
  };

  return {
    db: {
      select: () => selectChain,
      insert: () => insertChain,
      update: () => updateChain,
    },
    schema: {
      accounts: {
        id: 'accounts.id',
        siteId: 'accounts.siteId',
      },
      sites: {
        id: 'sites.id',
      },
      events: {},
    },
  };
});

vi.mock('./notifyService.js', () => ({
  sendNotification: (...args: unknown[]) => notifyMock(...args),
}));

vi.mock('./accountHealthService.js', () => ({
  setAccountRuntimeHealth: (...args: unknown[]) => runtimeHealthMock(...args),
}));

vi.mock('./sub2apiRefreshSingleflight.js', () => ({
  refreshSub2ApiManagedSessionSingleflight: (...args: unknown[]) => refreshSub2ApiManagedSessionMock(...args),
}));

function buildSub2ApiRow() {
  return {
    accounts: {
      id: 7,
      username: 'sub2-user',
      accessToken: 'expired-jwt',
      extraConfig: JSON.stringify({
        sub2apiAuth: {
          refreshToken: 'refresh-token',
          tokenExpiresAt: Date.now() - 1_000,
        },
      }),
    },
    sites: {
      id: 3,
      name: 'sub2',
      url: 'https://sub2.example.com',
      platform: 'sub2api',
    },
  };
}

describe('alertService sub2api managed refresh recovery', () => {
  beforeEach(() => {
    selectGetMock.mockReset();
    insertValuesMock.mockReset();
    updateSetMock.mockReset();
    notifyMock.mockReset();
    runtimeHealthMock.mockReset();
    refreshSub2ApiManagedSessionMock.mockReset();
  });

  it('refreshes managed sub2api session instead of marking the account expired', async () => {
    selectGetMock.mockResolvedValue(buildSub2ApiRow());
    refreshSub2ApiManagedSessionMock.mockResolvedValue({
      accessToken: 'fresh-jwt',
      extraConfig: JSON.stringify({
        sub2apiAuth: {
          refreshToken: 'refresh-token-2',
          tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        },
      }),
    });

    const { reportTokenExpired } = await import('./alertService.js');
    await reportTokenExpired({
      accountId: 7,
      username: 'sub2-user',
      siteName: 'sub2',
      detail: 'access token expired',
    });

    expect(refreshSub2ApiManagedSessionMock).toHaveBeenCalledTimes(1);
    expect(refreshSub2ApiManagedSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      currentAccessToken: 'expired-jwt',
      currentExtraConfig: expect.stringContaining('refresh-token'),
    }));
    expect(updateSetMock).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Token 已自动续期',
      level: 'info',
    }));
    expect(runtimeHealthMock).toHaveBeenCalledWith(7, expect.objectContaining({
      state: 'healthy',
      reason: 'Sub2API 访问令牌已自动续期',
    }));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('marks account expired when managed sub2api refresh is rejected', async () => {
    selectGetMock.mockResolvedValue(buildSub2ApiRow());
    refreshSub2ApiManagedSessionMock.mockRejectedValue(new Error('invalid refresh token'));

    const { reportTokenExpired } = await import('./alertService.js');
    await reportTokenExpired({
      accountId: 7,
      username: 'sub2-user',
      siteName: 'sub2',
      detail: 'access token expired',
    });

    expect(refreshSub2ApiManagedSessionMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Token 已失效',
      level: 'error',
      message: expect.stringContaining('自动续期失败：invalid refresh token'),
    }));
    expect(notifyMock).toHaveBeenCalledWith(
      'Token 已失效',
      expect.stringContaining('自动续期失败：invalid refresh token'),
      'error',
    );
  });
});
