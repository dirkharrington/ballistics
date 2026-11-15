declare module 'virtual:physics-tables' {
  const G1_TABLE: ReadonlyArray<readonly [number, number]>;
  const G7_TABLE: ReadonlyArray<readonly [number, number]>;
  const ATMOSPHERE: {
    readonly stdTempF: number;
    readonly lapseRatePer1000Ft: number;
    readonly rankineOffset: number;
    readonly pressureCoeff: number;
    readonly pressureExp: number;
  };
  export { G1_TABLE, G7_TABLE, ATMOSPHERE };
  const _default: { G1_TABLE: typeof G1_TABLE; G7_TABLE: typeof G7_TABLE; ATMOSPHERE: typeof ATMOSPHERE };
  export default _default;
}
