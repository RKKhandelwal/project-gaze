import { Type, type FunctionDeclaration } from "@google/genai";
import { presignOverlay } from "./r2";

// Gemini function-call tool definitions and their handlers.

const FILE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "get_video_url",
    description:
      "Generate a presigned, time-limited playback URL for a specific segment's overlay video (bounding boxes drawn on the court footage). Use whenever the user wants to watch a specific moment or you want to hand them a clickable link. Always render the returned URL in your reply as a markdown link.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileID: {
          type: Type.STRING,
          description:
            "The segment's fileID, exactly as it appears in the segments array (e.g. '20260517130105_13491621984'). Alphanumeric/underscore/dash only.",
        },
      },
      required: ["fileID"],
    },
  },
];

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string };

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_video_url": {
        const fileID = String(args.fileID ?? "");
        if (!FILE_ID_RE.test(fileID)) {
          return { ok: false, error: "Invalid fileID format" };
        }
        const url = await presignOverlay(fileID, 3600);
        return {
          ok: true,
          result: { url, expiresInSeconds: 3600 },
        };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "tool execution failed",
    };
  }
}
