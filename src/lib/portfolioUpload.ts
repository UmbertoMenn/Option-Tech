import type { ParsedPortfolioFile, PortfolioParseOptions } from './excelParser';

type GpSnapshotSource = Pick<
  ParsedPortfolioFile,
  'gpSnapshotPresent' | 'gpHoldings' | 'gpCashAccounts'
>;

const EXCLUDED_CASH_PATTERNS: Record<string, { mid?: string; last: string }[]> = {
  '7515bcc7-11b3-42c0-927d-4b2526f3a2b4': [{ mid: '2789', last: '0' }],
};

const PARSE_OPTIONS_BY_USERNAME: Record<string, PortfolioParseOptions> = {
  silvias: {
    excludedCashPatterns: [{ last: '452' }],
    excludedPositionDescriptions: ['BION ON', 'BION ON SPA'],
    excludedPositionIsins: ['US09075V1026'],
    includeGpCashInCash: true,
  },
  maurog: {
    excludedCashPatterns: [{ mid: '2789', last: '0' }],
  },
};

export function getEffectiveUploadUserId(
  isAdminMode: boolean,
  adminViewUserId: string | undefined,
  authenticatedUserId: string | undefined,
): string | undefined {
  return isAdminMode && adminViewUserId ? adminViewUserId : authenticatedUserId;
}

export function getPortfolioParseOptions(
  userId: string | undefined,
  username?: string,
): PortfolioParseOptions {
  const usernameOptions = PARSE_OPTIONS_BY_USERNAME[username?.trim().toLowerCase() || ''];
  return {
    excludedCashPatterns: [
      ...(EXCLUDED_CASH_PATTERNS[userId || ''] || []),
      ...(usernameOptions?.excludedCashPatterns || []),
    ],
    excludedPositionDescriptions: usernameOptions?.excludedPositionDescriptions
      ? [...usernameOptions.excludedPositionDescriptions]
      : undefined,
    excludedPositionIsins: usernameOptions?.excludedPositionIsins
      ? [...usernameOptions.excludedPositionIsins]
      : undefined,
    includeGpCashInCash: usernameOptions?.includeGpCashInCash,
  };
}

export function shouldRefreshGpSnapshot(parsedFiles: GpSnapshotSource[]): boolean {
  return parsedFiles.some(parsed =>
    parsed.gpSnapshotPresent
    || parsed.gpHoldings.length > 0
    || parsed.gpCashAccounts.length > 0
  );
}
