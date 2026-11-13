import { authorizeOperationToFinAPI, operationToFinAPI } from '../../src/plugins/mappers';
import { failedAuthorizeOperation, pendingAuthorizeOperation, successfulAuthorizeOperation } from '../../src/models';

describe('authorizeOperationToFinAPI', () => {
  test('a pending authorize maps to an incomplete status', () => {
    expect(authorizeOperationToFinAPI(pendingAuthorizeOperation('cid-1', undefined)))
      .toEqual({ type: 'authorize', operation: { cid: 'cid-1', isCompleted: false } });
  });

  test('a pending authorize that completes is reported as success', () => {
    expect(authorizeOperationToFinAPI(successfulAuthorizeOperation()))
      .toEqual({ type: 'authorize', operation: { cid: '', isCompleted: true, response: { type: 'erc20' } } });
  });

  test('a failed authorize carries the error', () => {
    expect(authorizeOperationToFinAPI(failedAuthorizeOperation(42, 'nope')))
      .toEqual({ type: 'authorize', operation: { cid: '', isCompleted: true, error: { code: 42, message: 'nope' } } });
  });

  test('operationToFinAPI routes an authorize operation instead of falling through', () => {
    expect(operationToFinAPI(pendingAuthorizeOperation('cid-2', undefined)))
      .toEqual({ type: 'authorize', operation: { cid: 'cid-2', isCompleted: false } });
  });
});
