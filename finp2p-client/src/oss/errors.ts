
export class ItemNotFoundError extends Error {
  constructor(itemId: string, itemType: string) {
    super(`${itemType} with id ${itemId} not found`);
    this.name = 'ItemNotFoundError';
  }
}
