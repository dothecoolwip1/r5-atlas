import type { LegalLandResult } from '../types';

export interface ConverterRuntime {
  convert(input: string): LegalLandResult;
}

export class LegalLandConverter {
  constructor(private readonly runtime: ConverterRuntime) {}

  convert(input: string): LegalLandResult {
    return this.runtime.convert(input);
  }
}
