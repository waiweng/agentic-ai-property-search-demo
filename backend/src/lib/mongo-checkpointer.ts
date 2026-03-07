import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  getCheckpointId,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointTuple,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type ChannelVersions,
} from '@langchain/langgraph-checkpoint';
import type { PendingWrite } from '@langchain/langgraph-checkpoint';
import { TASKS } from '@langchain/langgraph-checkpoint';
import type { SerializerProtocol } from '@langchain/langgraph-checkpoint';
import { getCheckpointsCollection, getCheckpointWritesCollection } from '../db/collections';

/** Normalize MongoDB blob (Buffer, BSON Binary, etc.) to Uint8Array for serde.loadsTyped. */
function toUint8Array(blob: unknown): Uint8Array {
  if (blob instanceof Uint8Array) return blob;
  if (blob instanceof Buffer) return new Uint8Array(blob);
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  const b = blob as { buffer?: ArrayBuffer; value?: () => Buffer; length?: number };
  if (b?.buffer instanceof ArrayBuffer) return new Uint8Array(b.buffer);
  if (typeof b?.value === 'function') return new Uint8Array(b.value() as Buffer);
  if (ArrayBuffer.isView(blob)) return new Uint8Array((blob as Uint8Array).buffer, (blob as Uint8Array).byteOffset, (blob as Uint8Array).byteLength);
  throw new Error('Checkpoint blob is not a valid buffer type');
}

/**
 * MongoDB-backed checkpointer so graph state is persisted per thread (sessionId).
 * Uses two collections: checkpoints (state snapshots) and checkpoint_writes (pending writes).
 */
export class MongoDBCheckpointSaver extends BaseCheckpointSaver {
  constructor(serde?: SerializerProtocol) {
    super(serde);
  }

  private async getStored(
    threadId: string,
    checkpointNs: string,
    checkpointId: string
  ): Promise<[Uint8Array, Uint8Array, string | undefined] | null> {
    const coll = await getCheckpointsCollection();
    const doc = await coll.findOne({
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: checkpointId,
    });
    if (!doc?.checkpoint_blob || !doc?.metadata_blob) return null;
    const checkpointBlob = toUint8Array(doc.checkpoint_blob);
    const metadataBlob = toUint8Array(doc.metadata_blob);
    return [
      checkpointBlob,
      metadataBlob,
      doc.parent_checkpoint_id ?? undefined,
    ];
  }

  private async getWritesForCheckpoint(
    threadId: string,
    checkpointNs: string,
    checkpointId: string
  ): Promise<[string, string, Uint8Array][]> {
    const coll = await getCheckpointWritesCollection();
    const cursor = coll.find({
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: checkpointId,
    });
    const out: [string, string, Uint8Array][] = [];
    for await (const doc of cursor) {
      const buf = toUint8Array(doc.value_blob);
      out.push([doc.task_id as string, doc.channel as string, buf]);
    }
    return out;
  }

  private async loadPendingSends(
    threadId: string,
    checkpointNs: string,
    parentCheckpointId: string
  ): Promise<{ node: string; args: unknown }[]> {
    const writes = await this.getWritesForCheckpoint(
      threadId,
      checkpointNs,
      parentCheckpointId
    );
    const taskWrites = writes.filter(([, channel]) => channel === TASKS);
    const pendingSends = await Promise.all(
      taskWrites.map(([, , value]) => this.serde.loadsTyped('json', value))
    );
    return pendingSends;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id as string | undefined;
    const checkpoint_ns = (config.configurable?.checkpoint_ns as string) ?? '';
    let checkpoint_id = getCheckpointId(config);

    if (!thread_id) return undefined;

    if (checkpoint_id) {
      const saved = await this.getStored(thread_id, checkpoint_ns, checkpoint_id);
      if (!saved) return undefined;
      const [checkpointBuf, metadataBuf, parentCheckpointId] = saved;
      const checkpoint = (await this.serde.loadsTyped(
        'json',
        checkpointBuf
      )) as Checkpoint;
      const pending_sends = parentCheckpointId
        ? await this.loadPendingSends(thread_id, checkpoint_ns, parentCheckpointId)
        : [];
      const deserializedCheckpoint = { ...checkpoint, pending_sends };
      const writes = await this.getWritesForCheckpoint(
        thread_id,
        checkpoint_ns,
        checkpoint_id
      );
      const pendingWrites = await Promise.all(
        writes.map(async ([taskId, channel, value]) => [
          taskId,
          channel,
          await this.serde.loadsTyped('json', value),
        ])
      );
      const metadata = (await this.serde.loadsTyped('json', metadataBuf)) as CheckpointMetadata;
      const tuple: CheckpointTuple = {
        config,
        checkpoint: deserializedCheckpoint,
        metadata,
        pendingWrites: pendingWrites as CheckpointTuple['pendingWrites'],
      };
      if (parentCheckpointId !== undefined) {
        tuple.parentConfig = {
          configurable: {
            thread_id,
            checkpoint_ns,
            checkpoint_id: parentCheckpointId,
          },
        };
      }
      return tuple;
    }

    // No checkpoint_id: load latest for this thread/ns
    const coll = await getCheckpointsCollection();
    const latest = await coll.findOne(
      { thread_id: thread_id, checkpoint_ns: checkpoint_ns },
      { sort: { checkpoint_id: -1 }, projection: { checkpoint_id: 1 } }
    );
    if (!latest) return undefined;
    checkpoint_id = latest.checkpoint_id as string;
    const saved = await this.getStored(thread_id, checkpoint_ns, checkpoint_id);
    if (!saved) return undefined;
    const [checkpointBuf, metadataBuf, parentCheckpointId] = saved;
    const checkpoint = (await this.serde.loadsTyped(
      'json',
      checkpointBuf
    )) as Checkpoint;
    const pending_sends = parentCheckpointId
      ? await this.loadPendingSends(thread_id, checkpoint_ns, parentCheckpointId)
      : [];
    const deserializedCheckpoint = { ...checkpoint, pending_sends };
    const writes = await this.getWritesForCheckpoint(
      thread_id,
      checkpoint_ns,
      checkpoint_id
    );
    const pendingWrites = await Promise.all(
      writes.map(async ([taskId, channel, value]) => [
        taskId,
        channel,
        await this.serde.loadsTyped('json', value),
      ])
    );
    const metadata = (await this.serde.loadsTyped('json', metadataBuf)) as CheckpointMetadata;
    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id,
          checkpoint_ns,
          checkpoint_id,
        },
      },
      checkpoint: deserializedCheckpoint,
      metadata,
      pendingWrites: pendingWrites as CheckpointTuple['pendingWrites'],
    };
    if (parentCheckpointId !== undefined) {
      tuple.parentConfig = {
        configurable: {
          thread_id,
          checkpoint_ns,
          checkpoint_id: parentCheckpointId,
        },
      };
    }
    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const thread_id = config.configurable?.thread_id as string | undefined;
    const checkpoint_ns = config.configurable?.checkpoint_ns as string | undefined;
    const configCheckpointId = config.configurable?.checkpoint_id as string | undefined;
    const { before, limit, filter } = options ?? {};

    const coll = await getCheckpointsCollection();
    const query: Record<string, unknown> = {};
    if (thread_id) query.thread_id = thread_id;
    if (checkpoint_ns !== undefined) query.checkpoint_ns = checkpoint_ns;
    const cursor = coll
      .find(query)
      .sort({ checkpoint_id: -1 })
      .project({
        thread_id: 1,
        checkpoint_ns: 1,
        checkpoint_id: 1,
        parent_checkpoint_id: 1,
        checkpoint_blob: 1,
        metadata_blob: 1,
      });

    let remaining = limit ?? Infinity;
    for await (const doc of cursor) {
      const checkpointId = doc.checkpoint_id as string;
      if (configCheckpointId && checkpointId !== configCheckpointId) continue;
      if (
        before?.configurable?.checkpoint_id &&
        String(checkpointId) >= String(before.configurable.checkpoint_id)
      )
        continue;

      const metadata = (await this.serde.loadsTyped(
        'json',
        toUint8Array(doc.metadata_blob)
      )) as CheckpointMetadata;
      if (
        filter &&
        !Object.entries(filter).every(([k, v]) => (metadata as Record<string, unknown>)[k] === v)
      )
        continue;
      if (remaining <= 0) break;
      remaining -= 1;

      const threadId = doc.thread_id as string;
      const checkpointNamespace = doc.checkpoint_ns as string;
      const parentCheckpointId = doc.parent_checkpoint_id as string | undefined;
      const checkpointBuf = toUint8Array(doc.checkpoint_blob);
      const checkpoint = (await this.serde.loadsTyped(
        'json',
        checkpointBuf
      )) as Checkpoint;
      const pending_sends = parentCheckpointId
        ? await this.loadPendingSends(threadId, checkpointNamespace, parentCheckpointId)
        : [];
      const writes = await this.getWritesForCheckpoint(
        threadId,
        checkpointNamespace,
        checkpointId
      );
      const pendingWrites = await Promise.all(
        writes.map(async ([taskId, channel, value]) => [
          taskId,
          channel,
          await this.serde.loadsTyped('json', value),
        ])
      );
      const tuple: CheckpointTuple = {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNamespace,
            checkpoint_id: checkpointId,
          },
        },
        checkpoint: { ...checkpoint, pending_sends },
        metadata,
        pendingWrites: pendingWrites as CheckpointTuple['pendingWrites'],
      };
      if (parentCheckpointId !== undefined) {
        tuple.parentConfig = {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNamespace,
            checkpoint_id: parentCheckpointId,
          },
        };
      }
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions?: ChannelVersions
  ): Promise<RunnableConfig> {
    const prepared = copyCheckpoint(checkpoint);
    delete (prepared as unknown as Record<string, unknown>).pending_sends;
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? '';
    if (threadId === undefined) {
      throw new Error(
        'Failed to put checkpoint. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.'
      );
    }
    const [, checkpointBuf] = await this.serde.dumpsTyped(prepared);
    const [, metadataBuf] = await this.serde.dumpsTyped(metadata);
    const coll = await getCheckpointsCollection();
    await coll.updateOne(
      {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
      {
        $set: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpoint.id,
          parent_checkpoint_id: config.configurable?.checkpoint_id ?? null,
          checkpoint_blob: Buffer.from(checkpointBuf),
          metadata_blob: Buffer.from(metadataBuf),
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = config.configurable?.checkpoint_ns as string;
    const checkpointId = config.configurable?.checkpoint_id as string;
    if (threadId === undefined) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.'
      );
    }
    if (checkpointId === undefined) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id" field in its "configurable" property.'
      );
    }
    const coll = await getCheckpointWritesCollection();
    const seen = new Set<string>();
    for (let idx = 0; idx < writes.length; idx++) {
      const [channel, value] = writes[idx];
      const [, valueBuf] = await this.serde.dumpsTyped(value);
      const innerKey = WRITES_IDX_MAP[channel] ?? idx;
      const keyStr = `${taskId},${innerKey}`;
      if (innerKey >= 0 && seen.has(keyStr)) continue;
      seen.add(keyStr);
      await coll.updateOne(
        {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId,
          task_id: taskId,
          channel_idx: innerKey,
        },
        {
          $set: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: checkpointId,
            task_id: taskId,
            channel: channel,
            channel_idx: innerKey,
            value_blob: Buffer.from(valueBuf),
            updated_at: new Date(),
          },
        },
        { upsert: true }
      );
    }
  }
}
