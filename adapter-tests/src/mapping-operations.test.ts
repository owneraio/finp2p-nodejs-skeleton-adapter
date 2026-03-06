import { MappingLedgerAPI } from './api/mapping';

export function mappingOperationsTests() {
  describe('Mapping Operations', () => {
    let mapping: MappingLedgerAPI;

    beforeAll(() => {
      // @ts-ignore
      const baseAddress = global.serverBaseAddress ?? global.serverAddress;
      mapping = new MappingLedgerAPI(baseAddress);
    });

    describe('Fields', () => {
      test('should return supported mapping fields', async () => {
        const fields = await mapping.getMappingFields();
        expect(fields.length).toBeGreaterThan(0);
        for (const field of fields) {
          expect(field.field).toBeDefined();
          expect(field.description).toBeDefined();
          expect(field.exampleValue).toBeDefined();
        }
      });
    });

    describe('Create and Query', () => {
      test('should create an owner mapping', async () => {
        const result = await mapping.createOwnerMapping({
          finId: 'test-fin-id-001',
          accountMappings: { ledgerAccountId: '0xabc123' },
        });
        expect(result.finId).toBe('test-fin-id-001');
        expect(result.status).toBe('active');
        expect(result.accountMappings.ledgerAccountId).toBe('0xabc123');
      });

      test('should query all mappings', async () => {
        await mapping.createOwnerMapping({
          finId: 'test-fin-id-002',
          accountMappings: { ledgerAccountId: '0xdef456' },
        });

        const all = await mapping.getOwnerMappings();
        expect(all.length).toBeGreaterThanOrEqual(2);
        const finIds = all.map(m => m.finId);
        expect(finIds).toContain('test-fin-id-001');
        expect(finIds).toContain('test-fin-id-002');
      });

      test('should query mappings filtered by finIds', async () => {
        const filtered = await mapping.getOwnerMappings(['test-fin-id-001']);
        expect(filtered.length).toBe(1);
        expect(filtered[0].finId).toBe('test-fin-id-001');
        expect(filtered[0].accountMappings.ledgerAccountId).toBe('0xabc123');
      });

      test('should return empty for unknown finId', async () => {
        const filtered = await mapping.getOwnerMappings(['does-not-exist']);
        expect(filtered.length).toBe(0);
      });
    });

    describe('Idempotency', () => {
      test('should be idempotent on duplicate create', async () => {
        await mapping.createOwnerMapping({
          finId: 'test-fin-id-idem',
          accountMappings: { ledgerAccountId: '0xsame' },
        });
        const second = await mapping.createOwnerMapping({
          finId: 'test-fin-id-idem',
          accountMappings: { ledgerAccountId: '0xsame' },
        });
        expect(second.finId).toBe('test-fin-id-idem');
        expect(second.accountMappings.ledgerAccountId).toBe('0xsame');
      });
    });

    describe('Multiple accounts per finId', () => {
      test('should support multiple ledger accounts for same finId', async () => {
        await mapping.createOwnerMapping({
          finId: 'test-fin-id-multi',
          accountMappings: { ledgerAccountId: '0xaccount1' },
        });
        await mapping.createOwnerMapping({
          finId: 'test-fin-id-multi',
          accountMappings: { ledgerAccountId: '0xaccount2' },
        });

        const filtered = await mapping.getOwnerMappings(['test-fin-id-multi']);
        expect(filtered.length).toBe(2);
        const accounts = filtered.map(m => m.accountMappings.ledgerAccountId).sort();
        expect(accounts).toEqual(['0xaccount1', '0xaccount2']);
      });
    });

    describe('Deactivation', () => {
      test('should deactivate mapping with status inactive', async () => {
        await mapping.createOwnerMapping({
          finId: 'test-fin-id-deact',
          accountMappings: { ledgerAccountId: '0xremoveme' },
        });

        const deactivated = await mapping.createOwnerMapping({
          finId: 'test-fin-id-deact',
          status: 'inactive',
          accountMappings: { ledgerAccountId: '0xremoveme' },
        });
        expect(deactivated.status).toBe('inactive');

        const remaining = await mapping.getOwnerMappings(['test-fin-id-deact']);
        expect(remaining.length).toBe(0);
      });
    });
  });
}
