// Single-table DynamoDB layout:
//   PK=DEPT#CS        SK=COURSE#CS310                     -> course list for search (hasSyllabi, inCatalog)
//   PK=COURSE#CS310   SK=META                             -> title, plus credits/description/prereqs
//                                                            for courses in the official catalog
//   PK=COURSE#CS310   SK=TERM#2022-3#SEC#001#<fileId>     -> one syllabus offering
//   PK=RATE#<ipHash>  SK=<hour>                           -> upload rate limit (TTL)
//   PK=CURATED        SK=<sourceUrl>                      -> scraped file an admin edited or deleted;
//                                                            the scraper leaves it alone from then on
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
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

  async function readAll(Command, params) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await db.send(new Command({ TableName: tableName, ...params, ExclusiveStartKey }));
      items.push(...(page.Items || []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }
  const queryAll = (params) => readAll(QueryCommand, params);

  // Marks a course as having syllabi and sets its title, on both the list entry and the course record.
  async function touchCourse({ dept, code, title, keepTitle }) {
    const titleExpr = keepTitle ? 'title = if_not_exists(title, :title)' : 'title = :title';
    const now = new Date().toISOString();
    await db.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `DEPT#${dept}`, SK: `COURSE#${code}` },
        UpdateExpression: `SET code = :code, ${titleExpr}, hasSyllabi = :yes, updatedAt = :now`,
        ExpressionAttributeValues: { ':code': code, ':title': title, ':yes': true, ':now': now },
      })
    );
    await db.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `COURSE#${code}`, SK: 'META' },
        UpdateExpression: `SET code = :code, ${titleExpr}, updatedAt = :now`,
        ExpressionAttributeValues: { ':code': code, ':title': title, ':now': now },
      })
    );
  }

  return {
    async listCourses(dept) {
      const items = await queryAll({
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `DEPT#${dept}` },
      });
      // Entries written before the catalog import have no hasSyllabi flag, but they all had syllabi.
      return items.map(({ code, title, hasSyllabi }) => ({
        code,
        display: displayCourse(code),
        title,
        hasSyllabi: hasSyllabi !== false,
      }));
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
        .map(({ SK, termKey, termLabel, section, instructors, title, fileId, contentType, source }) => ({
          id: SK,
          termKey,
          termLabel,
          section,
          instructors,
          title,
          fileId,
          contentType,
          source,
        }));
      return {
        code,
        display: displayCourse(code),
        title: meta.title,
        credits: meta.credits || '',
        description: meta.description || '',
        prereqs: meta.prereqs || '',
        offerings,
      };
    },

    // Every offering in the table, for the professor pages. A scan is fine at one
    // department's size (a few hundred items), and CloudFront caches the result.
    async listOfferings() {
      const items = await readAll(ScanCommand, {
        FilterExpression: 'begins_with(SK, :term)',
        ExpressionAttributeValues: { ':term': 'TERM#' },
        ProjectionExpression: 'code, title, termKey, termLabel, #section, instructors, fileId, #source',
        ExpressionAttributeNames: { '#section': 'section', '#source': 'source' },
      });
      return items.map((item) => ({ ...item, display: displayCourse(item.code) }));
    },

    async getCourseMeta(code) {
      const { Item } = await db.send(
        new GetCommand({ TableName: tableName, Key: { PK: `COURSE#${code}`, SK: 'META' } })
      );
      return Item || null;
    },

    // Writes the course entries and the offering. Course entries are updated, not replaced,
    // so catalog details survive; an existing title (the catalog's) is kept.
    async putOffering({ dept, code, title, term, section, instructors, fileId, contentType, source, sourceUrl }) {
      const now = new Date().toISOString();
      await touchCourse({ dept, code, title, keepTitle: true });
      await db.send(
        new PutCommand({
          TableName: tableName,
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
        })
      );
    },

    async getOffering(code, id) {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: { PK: `COURSE#${code}`, SK: id } }));
      return Item || null;
    },

    // Every offering that points at one file (a cross-listed syllabus has one per course code).
    async offeringsForFile(fileId) {
      return readAll(ScanCommand, {
        FilterExpression: 'begins_with(SK, :term) AND fileId = :file',
        ExpressionAttributeValues: { ':term': 'TERM#', ':file': fileId },
      });
    },

    // Rewrites an offering with new details. Course, term and section are part of the key,
    // so a change to any of them writes a new item and deletes the old one.
    async updateOffering(old, { dept, code, title, term, section, instructors }) {
      const updated = {
        ...old,
        PK: `COURSE#${code}`,
        SK: `TERM#${term.key}#SEC#${section}#${old.fileId}`,
        code,
        title,
        termKey: term.key,
        termLabel: term.label,
        section,
        instructors,
        updatedAt: new Date().toISOString(),
      };
      if (code !== old.code || !(await this.getCourseMeta(code))) {
        await this.putCourse({ dept, code, title });
      }
      await db.send(new PutCommand({ TableName: tableName, Item: updated }));
      if (updated.SK !== old.SK || updated.PK !== old.PK) await this.deleteOffering(old);
      return updated;
    },

    // Deletes one offering, and the course itself once it has no syllabi left.
    async deleteOffering(offering) {
      await db.send(new DeleteCommand({ TableName: tableName, Key: { PK: offering.PK, SK: offering.SK } }));
      const { Items: left = [] } = await db.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :term)',
          ExpressionAttributeValues: { ':pk': offering.PK, ':term': 'TERM#' },
          Limit: 1,
        })
      );
      if (left.length === 0) {
        const dept = offering.code.match(/^[A-Z]+/)[0];
        const listKey = { PK: `DEPT#${dept}`, SK: offering.PK };
        const meta = await this.getCourseMeta(offering.code);
        if (meta?.inCatalog) {
          // Catalog courses stay listed, just without syllabi.
          await db.send(
            new UpdateCommand({
              TableName: tableName,
              Key: listKey,
              UpdateExpression: 'SET hasSyllabi = :no',
              ExpressionAttributeValues: { ':no': false },
            })
          );
        } else {
          await db.send(new DeleteCommand({ TableName: tableName, Key: { PK: offering.PK, SK: 'META' } }));
          await db.send(new DeleteCommand({ TableName: tableName, Key: listKey }));
        }
      }
    },

    // Sets a course's title (an admin naming a new course, or renaming one).
    async putCourse({ dept, code, title }) {
      await touchCourse({ dept, code, title, keepTitle: false });
    },

    // Marks a scraped file as fixed by an admin, so the weekly scrape doesn't undo the fix.
    async markCurated(sourceUrl, { action, by }) {
      if (!sourceUrl) return;
      await db.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: 'CURATED', SK: sourceUrl, action, by, at: new Date().toISOString() },
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
