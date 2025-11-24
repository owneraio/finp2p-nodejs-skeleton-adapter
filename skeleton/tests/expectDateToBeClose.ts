export const expectDateToBeClose: (actual: Date, expected: Date) => void = (a, e) => {
  const actualSeconds = a.getTime() / 1000
  const expectedSeconds = e.getTime() / 1000

  expect(actualSeconds / 10).toBeCloseTo(expectedSeconds / 10, 0)
}
