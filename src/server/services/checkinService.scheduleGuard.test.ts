import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMock = {
  checkin: vi.fn(),
  login: vi.fn(),
};

const accountRowsMock = vi.fn();
const successfulCheckinRowsMock = vi.fn();
const insertValuesMock = vi.fn();

vi.mock('../db/index.js', () => {
  const schema = {
    accounts: {
      id: 'accounts.id',
      siteId: 'accounts.siteId',
      checkinEnabled: 'accounts.checkinEnabled',
      status: 'accounts.status',
    },
    sites: { id: 'sites.id' },
    checkinLogs: {
      accountId: 'checkinLogs.accountId',
      status: 'checkinLogs.status',
      createdAt: 'checkinLogs.createdAt',
    },
    events: {},
  };

  const makeSelectChain = () => {
    let selectedTable: unknown;
    const chain = {
      from: (table: unknown) => {
        selectedTable = table;
        return chain;
      },
      innerJoin: () => chain,
      where: () => chain,
      all: () => (
        selectedTable === schema.checkinLogs
          ? successfulCheckinRowsMock()
          : accountRowsMock()
      ),
    };
    return chain;
  };

  const insertChain = {
    values: (value: unknown) => {
      insertValuesMock(value);
      return insertChain;
    },
    run: () => ({}),
  };

  return {
    db: {
      select: () => makeSelectChain(),
      insert: () => insertChain,
      update: () => ({
        set: () => ({
          where: () => ({
            run: () => ({}),
          }),
        }),
      }),
    },
    schema,
  };
});

vi.mock('./platforms/index.js', () => ({
  getAdapter: () => adapterMock,
}));

vi.mock('./notifyService.js', () => ({
  sendNotification: vi.fn(),
}));

vi.mock('./alertService.js', () => ({
  reportTokenExpired: vi.fn(),
}));

vi.mock('./balanceService.js', () => ({
  refreshBalance: vi.fn(),
}));

vi.mock('./accountCredentialService.js', () => ({
  decryptAccountPassword: vi.fn(),
}));

vi.mock('./sub2apiRefreshSingleflight.js', () => ({
  refreshSub2ApiManagedSessionSingleflight: vi.fn(),
}));

describe('checkinService scheduled cron guard', () => {
  beforeEach(() => {
    accountRowsMock.mockReset();
    successfulCheckinRowsMock.mockReset();
    insertValuesMock.mockReset();
    adapterMock.checkin.mockReset();
    adapterMock.login.mockReset();
  });

  it('does not call upstream again when cron finds an account already succeeded today', async () => {
    accountRowsMock.mockReturnValue([
      {
        accounts: {
          id: 1,
          username: 'alice',
          accessToken: 'token-1',
          status: 'active',
          checkinEnabled: true,
        },
        sites: {
          id: 10,
          name: 'site-a',
          url: 'https://site-a.example.com',
          platform: 'new-api',
        },
      },
      {
        accounts: {
          id: 2,
          username: 'bob',
          accessToken: 'token-2',
          status: 'active',
          checkinEnabled: true,
        },
        sites: {
          id: 10,
          name: 'site-a',
          url: 'https://site-a.example.com',
          platform: 'new-api',
        },
      },
    ]);
    successfulCheckinRowsMock.mockReturnValue([
      { accountId: 1 },
      { accountId: 2 },
    ]);

    const { checkinAll } = await import('./checkinService.js');
    const results = await checkinAll({ scheduleMode: 'cron' });

    expect(adapterMock.checkin).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results.every((item) => item.result.status === 'skipped')).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledTimes(2);
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 1,
      status: 'skipped',
      message: expect.stringContaining('定时任务跳过'),
    }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 2,
      status: 'skipped',
      message: expect.stringContaining('定时任务跳过'),
    }));
  });
});
