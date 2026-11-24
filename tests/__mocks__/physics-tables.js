// Jest mock for virtual:physics-tables — mirrors physics-tables.yaml.
// Loaded at runtime so the test fixture stays in sync with the canonical YAML.
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const raw = fs.readFileSync(
  path.resolve(__dirname, '../../app/data/physics-tables.yaml'), 'utf-8');
const data = yaml.load(raw);

const G1_CD_TABLE   = data.g1CdTable.map(({ mach, cd }) => ({ mach, cd }));
const G5_CD_TABLE   = data.g5CdTable.map(({ mach, cd }) => ({ mach, cd }));
const G7_CD_TABLE   = data.g7CdTable.map(({ mach, cd }) => ({ mach, cd }));
const ATMOSPHERE = data.atmosphere;

module.exports            = { G1_CD_TABLE, G5_CD_TABLE, G7_CD_TABLE, ATMOSPHERE, default: { G1_CD_TABLE, G5_CD_TABLE, G7_CD_TABLE, ATMOSPHERE } };
module.exports.G1_CD_TABLE   = G1_CD_TABLE;
module.exports.G5_CD_TABLE   = G5_CD_TABLE;
module.exports.G7_CD_TABLE   = G7_CD_TABLE;
module.exports.ATMOSPHERE = ATMOSPHERE;
