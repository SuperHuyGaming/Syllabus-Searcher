// Creates the DynamoDB table in DynamoDB Local. In AWS the SAM template creates it.
const {
  DynamoDBClient,
  CreateTableCommand,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} = require('@aws-sdk/client-dynamodb');
const config = require('../src/config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!config.dynamoEndpoint) {
    throw new Error('DYNAMODB_ENDPOINT is not set. This script is for DynamoDB Local only.');
  }
  const client = new DynamoDBClient({ region: config.region, endpoint: config.dynamoEndpoint });

  // In Docker, DynamoDB Local may still be starting up.
  for (let attempt = 1; ; attempt++) {
    try {
      await createTable(client);
      return;
    } catch (err) {
      const starting = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err.code || err.cause?.code);
      if (!starting || attempt === 15) throw err;
      await sleep(2000);
    }
  }
}

async function createTable(client) {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: config.tableName,
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        // Same provisioned capacity as AWS, which stays inside the always-free 25/25.
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      })
    );
    await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: config.tableName });
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: config.tableName,
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      })
    );
    console.log(`Created table ${config.tableName}`);
  } catch (err) {
    if (err.name !== 'ResourceInUseException') throw err;
    console.log(`Table ${config.tableName} already exists`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
