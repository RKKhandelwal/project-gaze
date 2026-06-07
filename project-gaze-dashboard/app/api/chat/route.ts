import { NextRequest } from "next/server";
import { buildSystemInstruction, getCachedIndex, getGenAI } from "@/lib/gemini";
import { runTool, toolDeclarations } from "@/lib/chatTools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ClientMessage[];
  tz?: string;
}

const MODEL = "gemini-2.5-flash";
const MAX_TOOL_ITERATIONS = 5;

interface GeminiContent {
  role: "user" | "model";
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | {
        functionResponse: {
          name: string;
          response: Record<string, unknown>;
        };
      }
  >;
}

function toGeminiContents(messages: ClientMessage[]): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));
}

function encode(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + "\n");
}

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400,
    });
  }
  const tz = body.tz || "America/Los_Angeles";

  const ai = getGenAI();
  const index = await getCachedIndex();
  const systemInstruction = buildSystemInstruction(index, tz);
  const contents = toGeminiContents(messages);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const response = await ai.models.generateContentStream({
            model: MODEL,
            contents,
            config: {
              systemInstruction,
              tools: [{ functionDeclarations: toolDeclarations }],
              temperature: 0.3,
            },
          });

          const functionCalls: Array<{
            name: string;
            args: Record<string, unknown>;
          }> = [];

          // @google/genai's chunk.text concatenates all text parts on the
          // chunk. Depending on model/SDK version, the API may emit deltas
          // or cumulative snapshots, so we walk parts manually and only
          // forward the new suffix relative to what we've already streamed.
          let emittedText = "";
          const seenFunctionCalls = new Set<string>();

          for await (const chunk of response) {
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];

            // Aggregate text from this chunk, ignoring "thinking" parts.
            let chunkText = "";
            for (const p of parts) {
              if ((p as { thought?: boolean }).thought) continue;
              if (typeof p.text === "string") chunkText += p.text;
            }

            if (chunkText) {
              let delta: string;
              if (chunkText.startsWith(emittedText)) {
                delta = chunkText.slice(emittedText.length);
                emittedText = chunkText;
              } else {
                delta = chunkText;
                emittedText += chunkText;
              }
              if (delta) {
                controller.enqueue(encode({ type: "text", content: delta }));
              }
            }

            // Function calls. Dedupe — cumulative streaming repeats them.
            for (const p of parts) {
              const fc = (p as { functionCall?: { name?: string; args?: unknown } })
                .functionCall;
              if (!fc) continue;
              const name = fc.name ?? "unknown";
              const args = (fc.args ?? {}) as Record<string, unknown>;
              const id = `${name}::${JSON.stringify(args)}`;
              if (seenFunctionCalls.has(id)) continue;
              seenFunctionCalls.add(id);
              functionCalls.push({ name, args });
              controller.enqueue(
                encode({ type: "tool_call", name, args }),
              );
            }
          }

          // Build the model's turn for history with one final text part
          // plus any function calls, to avoid fragmenting history.
          const collectedParts: GeminiContent["parts"] = [];
          if (emittedText) collectedParts.push({ text: emittedText });
          for (const fc of functionCalls) {
            collectedParts.push({ functionCall: fc });
          }

          // No tool calls means we're done.
          if (functionCalls.length === 0) {
            controller.enqueue(encode({ type: "done" }));
            controller.close();
            return;
          }

          // Append model's turn (with calls) to history.
          contents.push({ role: "model", parts: collectedParts });

          // Execute tools, append results, and let the model continue.
          const responseParts: GeminiContent["parts"] = [];
          for (const fc of functionCalls) {
            const result = await runTool(fc.name, fc.args);
            controller.enqueue(
              encode({
                type: "tool_result",
                name: fc.name,
                ok: result.ok,
              }),
            );
            responseParts.push({
              functionResponse: {
                name: fc.name,
                response: result.ok
                  ? (result.result as Record<string, unknown>)
                  : { error: result.error },
              },
            });
          }
          contents.push({ role: "user", parts: responseParts });
        }

        // Iteration cap hit
        controller.enqueue(
          encode({
            type: "text",
            content:
              "\n\n_(stopping — too many tool iterations; rephrase your question?)_",
          }),
        );
        controller.enqueue(encode({ type: "done" }));
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "unknown error";
        controller.enqueue(encode({ type: "error", message }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
