import { ChatVertexAI } from '@langchain/google-vertexai';

function getProjectId(): string {
  const id = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!id) throw new Error('GOOGLE_CLOUD_PROJECT_ID not set');
  return id;
}

let chatModel: ChatVertexAI | null = null;

export async function getVertexModel(): Promise<ChatVertexAI> {
  if (chatModel) return chatModel;
  chatModel = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.3,
  } as any);
  console.log(`✅ Vertex AI initialized (${getProjectId()})`);
  return chatModel;
}
