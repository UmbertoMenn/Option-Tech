import { supabase } from '@/integrations/supabase/client';
import { ThetaDataHealth, ThetaDataRequest } from './types';

export class ThetaDataClientError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'ThetaDataClientError';
  }
}

export async function requestThetaData<T = unknown>(request: ThetaDataRequest): Promise<T> {
  const { data, error } = await supabase.functions.invoke('thetadata-proxy', {
    body: request,
  });

  if (error) {
    throw new ThetaDataClientError(error.message, 'FUNCTION_ERROR');
  }
  if (data?.error) {
    throw new ThetaDataClientError(data.error, data.code);
  }

  return data as T;
}

export async function checkThetaDataHealth(): Promise<ThetaDataHealth> {
  return requestThetaData<ThetaDataHealth>({ operation: 'health' });
}
