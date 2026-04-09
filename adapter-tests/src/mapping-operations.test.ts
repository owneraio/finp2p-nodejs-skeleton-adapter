import { MappingLedgerAPI } from './api/mapping';

// Valid hex finIds for testing (finId hex validation)
const FIN_ID_1 = 'aabb01';
const FIN_ID_2 = 'aabb02';
const FIN_ID_IDEM = 'ccdd01';
const FIN_ID_MULTI = 'eeff01';
const FIN_ID_DEACT = 'ff0011';
const FIN_ID_MULTI_FIELD = 'ff0022';

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
          finId: FIN_ID_1,
          accountMappings: { ledgerAccountId: '0xabc123' },
        });
        expect(result.finId).toBe(FIN_ID_1);
        expect(result.status).toBe('active');
        expect(result.accountMappings.ledgerAccountId).toBe('0xabc123');
      });

      test('should query all mappings', async () => {
        await mapping.createOwnerMapping({
          finId: FIN_ID_2,
          accountMappings: { ledgerAccountId: '0xdef456' },
        });

        const all = await mapping.getOwnerMappings();
        expect(all.length).toBeGreaterThanOrEqual(2);
        const finIds = all.map(m => m.finId);
        expect(finIds).toContain(FIN_ID_1);
        expect(finIds).toContain(FIN_ID_2);
      });

      test('should query mappings filtered by finIds', async () => {
        const filtered = await mapping.getOwnerMappings([FIN_ID_1]);
        expect(filtered.length).toBe(1);
        expect(filtered[0].finId).toBe(FIN_ID_1);
        expect(filtered[0].accountMappings.ledgerAccountId).toBe('0xabc123');
      });

      test('should return empty for unknown finId', async () => {
        const filtered = await mapping.getOwnerMappings(['abcdef99']);
        expect(filtered.length).toBe(0);
      });
    });

    describe('Idempotency', () => {
      test('should be idempotent on duplicate create', async () => {
        await mapping.createOwnerMapping({
          finId: FIN_ID_IDEM,
          accountMappings: { ledgerAccountId: '0xsame' },
        });
        const second = await mapping.createOwnerMapping({
          finId: FIN_ID_IDEM,
          accountMappings: { ledgerAccountId: '0xsame' },
        });
        expect(second.finId).toBe(FIN_ID_IDEM);
        expect(second.accountMappings.ledgerAccountId).toBe('0xsame');
      });
    });

    describe('Multiple fields per finId', () => {
      test('should support multiple account fields for same finId', async () => {
        const result = await mapping.createOwnerMapping({
          finId: FIN_ID_MULTI_FIELD,
          accountMappings: { ledgerAccountId: '0xaccount1', custodyAccountId: 'vault-123' },
        });
        expect(result.accountMappings.ledgerAccountId).toBe('0xaccount1');
        expect(result.accountMappings.custodyAccountId).toBe('vault-123');

        const filtered = await mapping.getOwnerMappings([FIN_ID_MULTI_FIELD]);
        expect(filtered.length).toBe(1);
        expect(filtered[0].accountMappings.ledgerAccountId).toBe('0xaccount1');
        expect(filtered[0].accountMappings.custodyAccountId).toBe('vault-123');
      });

      test('should update existing field value on re-post', async () => {
        await mapping.createOwnerMapping({
          finId: FIN_ID_MULTI,
          accountMappings: { ledgerAccountId: '0xoriginal' },
        });
        const updated = await mapping.createOwnerMapping({
          finId: FIN_ID_MULTI,
          accountMappings: { ledgerAccountId: '0xupdated' },
        });
        expect(updated.accountMappings.ledgerAccountId).toBe('0xupdated');
      });
    });

    describe('Deactivation', () => {
      test('should deactivate mapping with status inactive', async () => {
        await mapping.createOwnerMapping({
          finId: FIN_ID_DEACT,
          accountMappings: { ledgerAccountId: '0xremoveme' },
        });

        const deactivated = await mapping.createOwnerMapping({
          finId: FIN_ID_DEACT,
          status: 'inactive',
          accountMappings: { ledgerAccountId: '0xremoveme' },
        });
        expect(deactivated.status).toBe('inactive');

        const remaining = await mapping.getOwnerMappings([FIN_ID_DEACT]);
        expect(remaining.length).toBe(0);
      });
    });

    describe('Validation', () => {
      test('should reject non-hex finId', async () => {
        try {
          await mapping.createOwnerMapping({
            finId: 'not-hex!',
            accountMappings: { ledgerAccountId: '0x123' },
          });
          fail('Expected 400 error');
        } catch (e: any) {
          expect(e.response.status).toBe(400);
          expect(e.response.data.error).toContain('hexadecimal');
        }
      });

      test('should reject empty accountMappings', async () => {
        try {
          await mapping.createOwnerMapping({
            finId: 'aabb01',
            accountMappings: {},
          });
          fail('Expected 400 error');
        } catch (e: any) {
          expect(e.response.status).toBe(400);
        }
      });
    });
  });
}
