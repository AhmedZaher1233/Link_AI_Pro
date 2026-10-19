/** Display label of an order line — shared by the order and invoice suites. */
export function orderLabel(customer: string, quantity: number): string {
  return customer + ' x ' + quantity;
}
