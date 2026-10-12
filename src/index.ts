#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clientFromEnv } from "./config.js";
import { registerTools } from "./tools.js";

async function main() {
  const client = clientFromEnv();
  const server = new McpServer(
    { name: "elearning-ut", version: "0.1.0" },
    {
      instructions:
        "Akses read-only ke elearning Universitas Terbuka (Moodle). Mulai dengan ut_daftar_mata_kuliah, lalu ut_isi_mata_kuliah untuk materi per sesi, ut_daftar_kuis / ut_daftar_tugas / ut_detail_tugas untuk kuis dan tugas, ut_tenggat_mendatang untuk jadwal. Server ini tidak bisa mengirim tugas, mengerjakan kuis, atau memposting diskusi; pengumpulan dilakukan manual oleh mahasiswa.",
    },
  );
  registerTools(server, client);
  await server.connect(new StdioServerTransport());
  // stdout dipakai protokol MCP; log hanya ke stderr.
  console.error(`elearning-ut MCP siap (${client.baseUrl}, read-only)`);
}

main().catch((err) => {
  console.error(`elearning-ut gagal start: ${(err as Error).message}`);
  process.exit(1);
});
