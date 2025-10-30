import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// 1️⃣ Servidor HTTP
// ===============================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ Servidor HTTP en puerto ${PORT}`);
});

// ===============================
// 2️⃣ Servidor WebSocket
// ===============================
const wss = new WebSocketServer({ server });
const cncClients = new Map(); // Mapa {uuid: ws}

wss.on("connection", (ws, req) => {
  console.log("🟢 Nueva conexión WebSocket");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "register") {
        cncClients.set(data.uuid, ws);
        console.log(`🤖 CNC registrada: ${data.uuid}`);
      } else if (data.type === "status") {
        console.log(`📡 Estado de ${data.uuid}: ${data.status}`);
      }
    } catch (err) {
      console.error("Error mensaje WS:", err);
    }
  });

  ws.on("close", () => {
    for (const [uuid, client] of cncClients.entries()) {
      if (client === ws) {
        cncClients.delete(uuid);
        console.log(`🔴 CNC desconectada: ${uuid}`);
        break;
      }
    }
  });
});

// ===============================
// 3️⃣ Endpoints HTTP para el frontend
// ===============================
app.get("/", (req, res) => {
  res.send("Servidor WebCNC activo 🚀");
});

// Enviar comando a una máquina
app.post("/send/:uuid", (req, res) => {
  const { uuid } = req.params;
  const { command } = req.body;

  const client = cncClients.get(uuid);
  if (!client) {
    return res.status(404).json({ message: "CNC no conectada" });
  }

  client.send(JSON.stringify({ type: "command", command }));
  res.json({ message: `Comando enviado a ${uuid}` });
});
