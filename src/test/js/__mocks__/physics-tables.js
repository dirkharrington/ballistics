// Jest mock for virtual:physics-tables — mirrors physics-tables.yaml.
// Loaded at runtime so the test fixture stays in sync with the canonical YAML.
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const raw = fs.readFileSync(
  path.resolve(__dirname, '../../../main/resources/physics-tables.yaml'), 'utf-8');
const data = yaml.load(raw);

const G1_TABLE   = data.g1Table.map(({ v, f }) => [v, f]);
const G7_TABLE   = data.g7Table.map(({ v, f }) => [v, f]);
const ATMOSPHERE = data.atmosphere;

module.exports            = { G1_TABLE, G7_TABLE, ATMOSPHERE, default: { G1_TABLE, G7_TABLE, ATMOSPHERE } };
module.exports.G1_TABLE   = G1_TABLE;
module.exports.G7_TABLE   = G7_TABLE;
module.exports.ATMOSPHERE = ATMOSPHERE;
