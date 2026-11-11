import { parseDragCsv } from '../../main/resources/static/drag-csv.js';

// Minimal valid CSV: 3 points spanning subsonic (≤0.5) through supersonic (≥2.0)
const VALID_CSV = `Mach,CD
0.3,0.3
1.0,0.5
2.5,0.4`;

describe('parseDragCsv', () => {
  describe('valid input', () => {
    it('parses a minimal valid CSV', () => {
      const result = parseDragCsv(VALID_CSV);
      expect(result).toEqual([
        { mach: 0.3, cd: 0.3 },
        { mach: 1.0, cd: 0.5 },
        { mach: 2.5, cd: 0.4 },
      ]);
    });

    it('handles Windows CRLF line endings', () => {
      const csv = 'Mach,CD\r\n0.3,0.3\r\n1.0,0.5\r\n2.5,0.4';
      const result = parseDragCsv(csv);
      expect(result).toHaveLength(3);
    });

    it('handles old Mac CR line endings', () => {
      const csv = 'Mach,CD\r0.3,0.3\r1.0,0.5\r2.5,0.4';
      const result = parseDragCsv(csv);
      expect(result).toHaveLength(3);
    });

    it('handles quoted column values', () => {
      const csv = '"Mach","CD"\n"0.3","0.3"\n"1.0","0.5"\n"2.5","0.4"';
      const result = parseDragCsv(csv);
      expect(result[0]).toEqual({ mach: 0.3, cd: 0.3 });
    });

    it('accepts headers in any order (CD before Mach)', () => {
      const csv = 'CD,Mach\n0.3,0.3\n0.5,1.0\n0.4,2.5';
      const result = parseDragCsv(csv);
      expect(result).toEqual([
        { mach: 0.3, cd: 0.3 },
        { mach: 1.0, cd: 0.5 },
        { mach: 2.5, cd: 0.4 },
      ]);
    });

    it('accepts case-insensitive headers (MACH, Cd)', () => {
      const csv = 'MACH,Cd\n0.3,0.3\n1.0,0.5\n2.5,0.4';
      const result = parseDragCsv(csv);
      expect(result).toHaveLength(3);
    });

    it('accepts extra whitespace around values', () => {
      const csv = 'Mach , CD \n 0.3 , 0.3 \n 1.0 , 0.5 \n 2.5 , 0.4 ';
      const result = parseDragCsv(csv);
      expect(result[0]).toEqual({ mach: 0.3, cd: 0.3 });
    });

    it('skips blank lines', () => {
      const csv = 'Mach,CD\n\n0.3,0.3\n\n1.0,0.5\n\n2.5,0.4\n';
      const result = parseDragCsv(csv);
      expect(result).toHaveLength(3);
    });

    it('accepts exactly 100 rows (maximum)', () => {
      const lines = ['Mach,CD'];
      // Build 100 rows with strictly increasing mach values using integer arithmetic
      // to avoid floating-point ordering issues.
      for (let i = 0; i < 100; i++) {
        const mach = (i * 50) / 1000; // 0.000, 0.050, 0.100, ... 4.950
        lines.push(`${mach.toFixed(3)},0.4`);
      }
      expect(lines.length).toBe(101); // header + 100 data rows
      // First row: mach=0.0 (≤0.5 ✓), last row mach=4.95 (≥2.0 ✓)
      const result = parseDragCsv(lines.join('\n'));
      expect(result).toHaveLength(100);
    });

    it('accepts exactly 3 rows (minimum)', () => {
      const result = parseDragCsv(VALID_CSV);
      expect(result).toHaveLength(3);
    });

    it('accepts mach at boundary 0.0', () => {
      const csv = 'Mach,CD\n0.0,0.3\n1.0,0.5\n2.5,0.4';
      const result = parseDragCsv(csv);
      expect(result[0].mach).toBe(0.0);
    });

    it('accepts mach at boundary 5.0', () => {
      const csv = 'Mach,CD\n0.3,0.3\n1.0,0.5\n5.0,0.4';
      const result = parseDragCsv(csv);
      expect(result[2].mach).toBe(5.0);
    });

    it('accepts CD at lower boundary 0.001', () => {
      const csv = 'Mach,CD\n0.3,0.001\n1.0,0.5\n2.5,0.4';
      const result = parseDragCsv(csv);
      expect(result[0].cd).toBe(0.001);
    });

    it('accepts CD at upper boundary 2.0', () => {
      const csv = 'Mach,CD\n0.3,2.0\n1.0,0.5\n2.5,0.4';
      const result = parseDragCsv(csv);
      expect(result[0].cd).toBe(2.0);
    });

    it('accepts low-mach point exactly at threshold 0.5', () => {
      const csv = 'Mach,CD\n0.5,0.3\n1.0,0.5\n2.5,0.4';
      const result = parseDragCsv(csv);
      expect(result).toHaveLength(3);
    });

    it('accepts high-mach point exactly at threshold 2.0', () => {
      const csv = 'Mach,CD\n0.3,0.3\n1.0,0.5\n2.0,0.4';
      const result = parseDragCsv(csv);
      expect(result).toHaveLength(3);
    });
  });

  describe('structural errors', () => {
    it('throws on empty string', () => {
      expect(() => parseDragCsv('')).toThrow('CSV must have a header row');
    });

    it('throws when only a header row (no data rows)', () => {
      expect(() => parseDragCsv('Mach,CD')).toThrow('CSV must have a header row');
    });

    it('throws when only 2 data rows (minimum is 3)', () => {
      const csv = 'Mach,CD\n0.3,0.3\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('CSV must have at least 3 data rows');
    });

    it('throws on 101 data rows (maximum is 100)', () => {
      const lines = ['Mach,CD'];
      for (let i = 0; i < 101; i++) {
        const mach = (i * 50) / 1000; // 0.000, 0.050, ... 5.000
        lines.push(`${mach.toFixed(3)},0.4`);
      }
      expect(lines.length).toBe(102); // header + 101 data rows
      expect(() => parseDragCsv(lines.join('\n'))).toThrow('CSV must have at most 100 data rows');
    });

    it('throws when Mach column is missing', () => {
      const csv = 'Range,CD\n100,0.3\n200,0.5\n300,0.4';
      expect(() => parseDragCsv(csv)).toThrow('CSV header must contain a "Mach" column');
    });

    it('throws when CD column is missing', () => {
      const csv = 'Mach,Drag\n0.3,0.3\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('CSV header must contain a "CD" column');
    });
  });

  describe('value errors', () => {
    it('throws on non-numeric mach value', () => {
      const csv = 'Mach,CD\nabc,0.3\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: mach value "abc" is not a valid decimal number');
    });

    it('throws on non-numeric CD value', () => {
      const csv = 'Mach,CD\n0.3,xyz\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: CD value "xyz" is not a valid decimal number');
    });

    it('throws on empty mach cell', () => {
      const csv = 'Mach,CD\n,0.3\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: mach value "" is not a valid decimal number');
    });

    it('throws on empty CD cell', () => {
      const csv = 'Mach,CD\n0.3,\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: CD value "" is not a valid decimal number');
    });

    it('throws on hex mach value', () => {
      const csv = 'Mach,CD\n0x1a,0.3\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: mach value "0x1a" is not a valid decimal number');
    });

    it('throws on hex CD value', () => {
      const csv = 'Mach,CD\n0.3,0xFF\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: CD value "0xFF" is not a valid decimal number');
    });

    it('throws on mach below 0.0', () => {
      const csv = 'Mach,CD\n-0.1,0.3\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: mach -0.1 is out of range');
    });

    it('throws on mach above 5.0', () => {
      const csv = 'Mach,CD\n0.3,0.3\n1.0,0.5\n5.1,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 3: mach 5.1 is out of range');
    });

    it('throws on CD below 0.001', () => {
      const csv = 'Mach,CD\n0.3,0.0005\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: CD 0.0005 is out of range');
    });

    it('throws on CD above 2.0', () => {
      const csv = 'Mach,CD\n0.3,2.1\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('Row 1: CD 2.1 is out of range');
    });
  });

  describe('ordering errors', () => {
    it('throws when mach values are not strictly increasing (equal)', () => {
      const csv = 'Mach,CD\n0.3,0.3\n0.3,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('mach values must be strictly increasing');
    });

    it('throws when mach values are decreasing', () => {
      const csv = 'Mach,CD\n0.3,0.3\n2.5,0.4\n1.0,0.5';
      expect(() => parseDragCsv(csv)).toThrow('mach values must be strictly increasing');
    });
  });

  describe('coverage errors', () => {
    it('throws when no subsonic point (all mach > 0.5)', () => {
      const csv = 'Mach,CD\n0.6,0.3\n1.0,0.5\n2.5,0.4';
      expect(() => parseDragCsv(csv)).toThrow('subsonic coverage');
    });

    it('throws when no supersonic point (all mach < 2.0)', () => {
      const csv = 'Mach,CD\n0.3,0.3\n1.0,0.5\n1.9,0.4';
      expect(() => parseDragCsv(csv)).toThrow('supersonic coverage');
    });
  });
});
