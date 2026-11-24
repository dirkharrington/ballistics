declare module 'virtual:physics-tables' {
  type CdRow = { readonly mach: number; readonly cd: number };
  const G1_CD_TABLE: ReadonlyArray<CdRow>;
  const G5_CD_TABLE: ReadonlyArray<CdRow>;
  const G7_CD_TABLE: ReadonlyArray<CdRow>;
  const ATMOSPHERE: {
    readonly stdTempF: number;
    readonly lapseRatePer1000Ft: number;
    readonly rankineOffset: number;
    readonly pressureCoeff: number;
    readonly pressureExp: number;
  };
  export { G1_CD_TABLE, G5_CD_TABLE, G7_CD_TABLE, ATMOSPHERE };
  const _default: { G1_CD_TABLE: typeof G1_CD_TABLE; G5_CD_TABLE: typeof G5_CD_TABLE; G7_CD_TABLE: typeof G7_CD_TABLE; ATMOSPHERE: typeof ATMOSPHERE };
  export default _default;
}
