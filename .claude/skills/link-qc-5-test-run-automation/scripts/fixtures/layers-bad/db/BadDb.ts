// Fixture query object with violations — every finding line carries an `expect:` marker the harness reads.
type Prisma = { order: { create(o: object): Promise<unknown>; findMany(o: object): Promise<unknown> } };
export class BadDb {
  constructor(private readonly prisma: Prisma, private readonly db: { read(n: string, s: string, p: unknown[]): Promise<unknown> }) {}
  async add() { return this.prisma.order.create({ data: { name: 'x' } }); } // expect: db-write-unledgered
  async all() { return this.prisma.order.findMany({}); } // expect: db-record-missing
  async wipe() { return this.db.read('wipe', 'DELETE FROM orders WHERE name = $1', ['x']); } // expect: db-write-freeform
  url() { return process.env.DATABASE_URL; } // expect: db-env-not-qc
  ok() { return process.env.QA_DB_ORDERS_URL; }
}
