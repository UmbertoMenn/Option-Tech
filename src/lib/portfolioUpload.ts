import type { ParsedPortfolioFile, PortfolioParseOptions } from './excelParser';

type GpSnapshotSource = Pick<
  ParsedPortfolioFile,
  'gpSnapshotPresent' | 'gpHoldings' | 'gpCashAccounts'
>;

type PositionsSnapshotSource = Pick<ParsedPortfolioFile, 'positionsSnapshotPresent'>;

const EXCLUDED_CASH_PATTERNS: Record<string, { mid?: string; last: string }[]> = {
  '7515bcc7-11b3-42c0-927d-4b2526f3a2b4': [{ mid: '2789', last: '0' }],
};

const PARSE_OPTIONS_BY_USERNAME: Record<string, PortfolioParseOptions> = {
  silvias: {
    excludedCashPatterns: [{ last: '452' }],
    // Titolo da escludere: Bio-On S.p.A. Nel flusso banca la descrizione
    // esatta è "BIO ON SPA" e l'ISIN è IT0005056236. Le vecchie voci
    // "BION ON"/"BION ON SPA" e l'ISIN US09075V1026 erano trascrizioni
    // errate: il match esatto non scattava mai e il titolo restava
    // incluso nel patrimonio ad ogni upload.
    excludedPositionDescriptions: ['BIO ON', 'BIO ON SPA', 'BIO-ON SPA'],
    excludedPositionIsins: ['IT0005056236'],
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

export function shouldRefreshPositionsSnapshot(parsedFiles: PositionsSnapshotSource[]): boolean {
  return parsedFiles.some(parsed => parsed.positionsSnapshotPresent);
}

export type PortfolioUploadMode = 'csv' | 'legacy';

const SUPPORTED_UPLOAD_EXTENSIONS: Record<PortfolioUploadMode | 'all', RegExp> = {
  csv: /\.csv$/i,
  legacy: /\.(xlsx|xls)$/i,
  all: /\.(csv|xlsx|xls)$/i,
};

/**
 * Filtra un elenco di File (es. da `clipboardData.files` su un evento paste)
 * mantenendo solo quelli con estensione supportata dal caricatore portfolio.
 *
 * Usata per il paste da appunti: a differenza del drag-and-drop, che alcuni
 * client email/browser bloccano con il cursore "divieto" perché il drag non
 * espone "Files" in dataTransfer.types, Ctrl+V con un file copiato dal client
 * email mette i byte reali sugli appunti del sistema operativo e bypassa quel
 * limite. Il filtro evita di intercettare un normale paste di testo (che non
 * ha mai file allegati) e scarta allegati di tipo non gestito.
 */
export function filterSupportedUploadFiles(
  files: File[],
  mode: PortfolioUploadMode | 'all' = 'all',
): File[] {
  return files.filter(file => SUPPORTED_UPLOAD_EXTENSIONS[mode].test(file.name));
}
