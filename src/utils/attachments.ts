import { type Attachment } from "discord.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const ATTACHMENT_DIR = join(tmpdir(), "queen-attachments");

/**
 * Download Discord attachments to a temp directory.
 * Returns an array of local file paths.
 */
export async function downloadAttachments(
  attachments: Attachment[],
): Promise<string[]> {
  await mkdir(ATTACHMENT_DIR, { recursive: true });

  const paths: string[] = [];

  for (const att of attachments) {
    try {
      const response = await fetch(att.url);
      if (!response.ok) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      const filename = `${Date.now()}-${att.name ?? "file"}`;
      const filepath = join(ATTACHMENT_DIR, filename);
      await writeFile(filepath, buffer);
      paths.push(filepath);
    } catch (err) {
      console.error(`[queen] Failed to download attachment ${att.name}:`, err);
    }
  }

  return paths;
}
