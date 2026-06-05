import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { sendNotification } from './notifyService.js';
import { setAccountRuntimeHealth } from './accountHealthService.js';
import { appendSessionTokenRebindHint } from './alertRules.js';
import { formatUtcSqlDateTime } from './localTimeService.js';
import { getSub2ApiAuthFromExtraConfig } from './accountExtraConfig.js';
import { isSub2ApiPlatform } from './sub2apiManagedAuth.js';
import { refreshSub2ApiManagedSessionSingleflight } from './sub2apiRefreshSingleflight.js';

function normalizeErrorSnippet(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || '');
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > 200
    ? `${normalized.slice(0, 197)}...`
    : normalized;
}

async function tryRecoverSub2ApiExpiredToken(accountId: number): Promise<{
  recovered: boolean;
  errorMessage?: string;
}> {
  const row = await db.select()
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(eq(schema.accounts.id, accountId))
    .get();
  if (!row) return { recovered: false };

  const account = row.accounts;
  const site = row.sites;
  if (!isSub2ApiPlatform(site.platform)) return { recovered: false };

  const managedAuth = getSub2ApiAuthFromExtraConfig(account.extraConfig);
  if (!managedAuth?.refreshToken) return { recovered: false };

  try {
    await refreshSub2ApiManagedSessionSingleflight({
      account,
      site,
      currentAccessToken: account.accessToken || '',
      currentExtraConfig: account.extraConfig,
    });
    return { recovered: true };
  } catch (error) {
    return {
      recovered: false,
      errorMessage: normalizeErrorSnippet(error),
    };
  }
}

export async function reportTokenExpired(params: {
  accountId: number;
  username?: string | null;
  siteName?: string | null;
  detail?: string;
}) {
  const accountLabel = params.username || `ID:${params.accountId}`;
  const siteLabel = params.siteName || 'unknown-site';
  const recovery = await tryRecoverSub2ApiExpiredToken(params.accountId);
  const createdAt = formatUtcSqlDateTime(new Date());

  if (recovery.recovered) {
    await db.insert(schema.events).values({
      type: 'token',
      title: 'Token 已自动续期',
      message: `${accountLabel} @ ${siteLabel} 的 Sub2API 访问令牌已自动续期`,
      level: 'info',
      relatedId: params.accountId,
      relatedType: 'account',
      createdAt,
    }).run();

    setAccountRuntimeHealth(params.accountId, {
      state: 'healthy',
      reason: 'Sub2API 访问令牌已自动续期',
      source: 'auth',
    });
    return;
  }

  const recoveryFailureText = recovery.errorMessage
    ? `；自动续期失败：${recovery.errorMessage}`
    : '';
  const detailText = params.detail
    ? appendSessionTokenRebindHint(`${params.detail}${recoveryFailureText}`)
    : recoveryFailureText.replace(/^；/, '');
  const detail = detailText ? ` (${detailText})` : '';

  await db.insert(schema.events).values({
    type: 'token',
    title: 'Token 已失效',
    message: `${accountLabel} @ ${siteLabel} 的 Token 无效或已过期${detail}`,
    level: 'error',
    relatedId: params.accountId,
    relatedType: 'account',
    createdAt,
  }).run();

  await db.update(schema.accounts).set({
    status: 'expired',
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.accounts.id, params.accountId)).run();

  setAccountRuntimeHealth(params.accountId, {
    state: 'unhealthy',
    reason: detailText ? `访问令牌失效：${detailText}` : '访问令牌失效',
    source: 'auth',
  });

  await sendNotification(
    'Token 已失效',
    `${accountLabel} @ ${siteLabel} 的 Token 无效或已过期${detail}`,
    'error',
  );
}

export async function reportProxyAllFailed(params: { model: string; reason: string }) {
  const createdAt = formatUtcSqlDateTime(new Date());
  await db.insert(schema.events).values({
    type: 'proxy',
    title: '代理全部失败',
    message: `模型=${params.model}, 原因=${params.reason}`,
    level: 'error',
    relatedType: 'route',
    createdAt,
  }).run();

  await sendNotification(
    '代理全部失败',
    `模型=${params.model}, 原因=${params.reason}`,
    'error',
  );
}
