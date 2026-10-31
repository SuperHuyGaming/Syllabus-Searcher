// Single-table DynamoDB layout:
//   PK=DEPT#CS        SK=COURSE#CS310                     -> course list for search
//   PK=COURSE#CS310   SK=META                             -> course title
//   PK=COURSE#CS310   SK=TERM#2022-3#SEC#001#<fileId>     -> one syllabus offering
//   PK=RATE#<ipHash>  SK=<hour>                           -> upload rate limit (TTL)
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
  GetCommand,
} = require('@aws-sdk/lib-dynamodb');
const config = require('../config');
const { displayCourse } = require('../lib/terms');

function createCatalog({ client, tableName = config.tableName } = {}) {
  const db =
    client ||
    DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: config.region, endpoint: config.dynamoEndpoint }),
      { marshallOptions: { removeUndefinedValues: true } }
    );

  async function queryAll(params) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await db.send(new QueryCommand({ TableName: tableName, ...params, ExclusiveStartKey }));
      items.push(...(page.Items || []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  return {
    async listCourses(dept) {
      const items = await queryAll({
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `DEPT#${dept}` },
      });
      return items.map(({ code, title }) => ({ code, display: displayCourse(code), title }));
    },

    async getCourse(code) {
      const items = await queryAll({
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `COURSE#${code}` },
        ScanIndexForward: false,
      });
      const meta = items.find((item) => item.SK === 'META');
      if (!meta) return null;
      const offerings = items
        .filter((item) => item.SK.startsWith('TERM#'))
        .map(({ termKey, termLabel, section, instructors, title, fileId, contentType, source }) => ({
          termKey,
          termLabel,
          section,
          instructors,
          title,
          fileId,
          contentType,
          source,
        }));
      return { code, display: displayCourse(code), title: meta.title, offerings };
    },

    async getCourseMeta(code) {
      const { Item } = await db.send(
        new GetCommand({ TableName: tableName, Key: { PK: `COURSE#${code}`, SK: 'META' } })
      );
      return Item || null;
    },

    // Writes the course list entry, course title and the offering in one batch.
    async putOffering({ dept, code, title, term, section, instructors, fileId, contentType, source, sourceUrl }) {
      const now = new Date().toISOString();
      await db.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: [
              { PutRequest: { Item: { PK: `DEPT#${dept}`, SK: `COURSE#${code}`, code, title, updatedAt: now } } },
              { PutRequest: { Item: { PK: `COURSE#${code}`, SK: 'META', code, title, updatedAt: now } } },
              {
                PutRequest: {
                  Item: {
                    PK: `COURSE#${code}`,
                    SK: `TERM#${term.key}#SEC#${section}#${fileId}`,
                    code,
                    title,
                    termKey: term.key,
                    termLabel: term.label,
                    section,
                    instructors,
                    fileId,
                    contentType,
                    source,
                    sourceUrl,
                    createdAt: now,
                  },
                },
              },
            ],
          },
        })
      );
    },

    // Returns false once the caller has used up its uploads for this hour.
    async hitRateLimit(key, max) {
      const hour = new Date().toISOString().slice(0, 13);
      try {
        await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: `RATE#${key}`, SK: hour },
            UpdateExpression: 'ADD hits :one SET expiresAt = :ttl',
            ConditionExpression: 'attribute_not_exists(hits) OR hits < :max',
            ExpressionAttributeValues: {
              ':one': 1,
              ':max': max,
              ':ttl': Math.floor(Date.now() / 1000) + 2 * 3600,
            },
          })
        );
        return true;
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },

    async ping() {
      await db.send(new GetCommand({ TableName: tableName, Key: { PK: 'HEALTH', SK: 'HEALTH' } }));
    },
  };
}

module.exports = { createCatalog };
