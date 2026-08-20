import { createServer } from "node:net";

/** Accept one SMTP conversation so send_outreach can succeed in e2e. */
export function startFakeSmtp(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      socket.write("220 localhost\r\n");
      socket.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        for (const raw of text.split(/\r\n/)) {
          const line = raw.trim();
          if (!line) continue;
          const verb = line.toUpperCase();
          if (line === ".") {
            socket.write("250 OK\r\n");
          } else if (verb === "DATA") {
            socket.write("354 go\r\n");
          } else if (verb === "QUIT") {
            socket.write("221 bye\r\n");
            socket.end();
          } else if (
            verb.startsWith("EHLO") ||
            verb.startsWith("HELO") ||
            verb.startsWith("MAIL") ||
            verb.startsWith("RCPT") ||
            verb.startsWith("RSET")
          ) {
            socket.write("250 OK\r\n");
          }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("smtp listen failed"));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise((res, rej) =>
            server.close((error) => (error ? rej(error) : res()))
          ),
      });
    });
    server.on("error", reject);
  });
}
