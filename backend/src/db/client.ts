import { MongoClient, Db } from 'mongodb';

const MONGO_UNREACHABLE_MSG =
  'MongoDB is unreachable. Check your network, VPN, and that MONGODB_ATLAS_URI is correct and the cluster is running.';

function getMongoDBURI(): string {
  const uri = process.env.MONGODB_ATLAS_URI;
  if (!uri) {
    throw new Error('MONGODB_ATLAS_URI not set. Make sure .env is loaded.');
  }
  return uri;
}

let client: MongoClient | null = null;
/** Set when connection has failed so we don't retry on every request. */
let connectionFailed = false;

export function isMongoConnected(): boolean {
  return client != null && !connectionFailed;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (connectionFailed) {
    throw new Error(MONGO_UNREACHABLE_MSG);
  }
  if (client) return client;
  client = new MongoClient(getMongoDBURI());
  try {
    await client.connect();
    return client;
  } catch (e) {
    connectionFailed = true;
    client = null;
    throw e;
  }
}

export const DB_NAME = 'property_search';

export async function getDb(): Promise<Db> {
  const c = await getMongoClient();
  return c.db(DB_NAME);
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
  connectionFailed = false;
}
