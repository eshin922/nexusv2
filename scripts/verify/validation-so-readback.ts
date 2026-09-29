import { suiteQL, describeNetsuiteTarget } from '@/lib/netsuite/client';

// Read-only certification of the five fictional orders placed through Nexus.
// SuiteQL presents transaction-line quantities and amounts with negative signs;
// compare their magnitudes to the customer-facing order values.
const expected: Record<string, { total: number; lines: Array<[string, number, number]> }> = {
  SO2737: { total: 306.5, lines: [['76155', 200, 130.5], ['76156', 100, 43.5], ['76157', 100, 20], ['76158', 50, 30], ['76162', 50, 82.5]] },
  SO2738: { total: 58, lines: [['76155', 100, 29], ['76156', 200, 29]] },
  SO2739: { total: 126, lines: [['76155', 100, 58], ['14525', 100, 42], ['7792', 1, 26]] },
  SO2740: { total: 189, lines: [['76158', 100, 189]] },
  SO2741: { total: 253.2, lines: [['76155', 120, 87], ['76158', 120, 54], ['76154', 120, 67.2], ['4076', 1, 24], ['26348', 1, 21]] },
};

function sameMoney(actual: unknown, amount: number): boolean {
  return Math.abs(Math.abs(Number(actual)) - amount) < 0.00001;
}

async function main() {
  const target = describeNetsuiteTarget();
  if (!target.accountIsSandbox) throw new Error('Sandbox target required');

  const orders = await suiteQL<Record<string, unknown>>(`
  select id, tranid, entity, foreigntotal
  from transaction
  where type = 'SalesOrd' and tranid in ('SO2737','SO2738','SO2739','SO2740','SO2741')
  order by tranid
`);
  if (orders.items.length !== Object.keys(expected).length) {
    throw new Error(`Expected five sandbox Sales Orders; found ${orders.items.length}`);
  }
  for (const order of orders.items) {
    const name = String(order.tranid);
    const check = expected[name];
    if (!check || !sameMoney(order.foreigntotal, check.total) || String(order.entity) !== '388800') {
      throw new Error(`${name}: customer or total differs from the Nexus record`);
    }
    const lines = await suiteQL<Record<string, unknown>>(`
    select linesequencenumber, item, quantity, rate, netamount
    from transactionline
    where transaction = ${String(order.id)} and mainline = 'F' and taxline = 'F'
    order by linesequencenumber
  `);
    if (lines.items.length !== check.lines.length) throw new Error(`${name}: unexpected line count`);
    for (const [i, [item, quantity, amount]] of check.lines.entries()) {
      const line = lines.items[i];
      if (String(line.item) !== item || Math.abs(Number(line.quantity)) !== quantity || !sameMoney(line.netamount, amount)) {
        throw new Error(`${name} line ${i + 1}: item, quantity, or amount differs from Nexus`);
      }
    }
    console.log(`${name}: ${check.lines.length} lines and $${check.total.toFixed(2)} verified`);
  }
  const items = await suiteQL<Record<string, unknown>>(`
    select id, itemid, itemtype, displayname
    from item
    where id in (4076,4077,26348,76154,14525,7792)
    order by id
  `);
  console.log(JSON.stringify({ mappedItems: items.items }));
}

void main();
