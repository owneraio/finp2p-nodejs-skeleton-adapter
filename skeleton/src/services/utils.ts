

export function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateCid(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}
