import express from "express";
import cors from "cors";
import multer from "multer";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// ===============================
// 1️⃣ Conexión a Supabase
// ===============================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("✅ Conectado a Supabase:", SUPABASE_URL);

// ===============================
// 2️⃣ Configuración básica del servidor
// ===============================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// 3️⃣ Servidor HTTP
// ===============================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ Servidor HTTP en puerto ${PORT}`);
});

// ===============================
// 4️⃣ Servidor WebSocket
// ===============================
const wss = new WebSocketServer({ server });
const cncClients = new Map(); // Mapa {uuid: ws}

wss.on("connection", (ws) => {
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
// 5️⃣ Endpoints HTTP
// ===============================

app.get("/", (req, res) => {
  res.send("Servidor WebCNC activo 🚀");
});

// --- Registrar CNC ---
app.post("/api/register-cnc", async (req, res) => {
  const { uuid, nombre, modelo, ubicacion } = req.body;
  const { data, error } = await supabase
    .from("cnc")
    .insert([{ uuid, nombre, modelo, ubicacion, estado: "offline" }])
    .select();

  if (error) {
    console.error("❌ Error al registrar CNC:", error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: "✅ CNC registrada en Supabase", data });
});

// --- Crear trabajo ---
app.post("/api/trabajos", async (req, res) => {
  const { id_cnc, id_diseno, duracion, estado } = req.body;
  const { data, error } = await supabase
    .from("trabajo")
    .insert([{ id_cnc, id_diseno, duracion, estado }])
    .select();

  if (error) {
    console.error("❌ Error al registrar trabajo:", error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: "✅ Trabajo registrado en Supabase", data });
});

// --- Listar trabajos ---
app.get("/api/trabajos", async (req, res) => {
  const { data, error } = await supabase
    .from("trabajo")
    .select(`
      id_trabajo,
      id_cnc (uuid, nombre),
      id_diseno (nombre),
      duracion,
      tiempo_ini,
      tiempo_fin,
      estado
    `)
    .order("tiempo_ini", { ascending: false });

  if (error) {
    console.error("❌ Error al obtener trabajos:", error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: "✅ Lista de trabajos", data });
});

// --- Registrar diseño ---
app.post("/api/disenos", async (req, res) => {
  const { nombre, id_usuario } = req.body;
  const { data, error } = await supabase
    .from("diseno")
    .insert([{ nombre, id_usuario }])
    .select();

  if (error) {
    console.error("❌ Error al registrar diseño:", error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: "✅ Diseño registrado en Supabase", data });
});

// --- Listar diseños ---
app.get("/api/disenos", async (req, res) => {
  const { data, error } = await supabase
    .from("diseno")
    .select(`
      id_diseno,
      nombre,
      fech_diseno,
      id_usuario (email)
    `)
    .order("fech_diseno", { ascending: false });

  if (error) {
    console.error("❌ Error al obtener diseños:", error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: "✅ Lista de diseños", data });
});

// ===============================
// 6️⃣ Subida de archivos G-code
// ===============================
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/api/upload-gcode", upload.single("archivo"), async (req, res) => {
  try {
    const { id_diseno } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No se ha enviado ningún archivo" });

    const fileName = `diseno_${id_diseno}_${Date.now()}.gcode`;

    const { error: uploadError } = await supabase.storage
      .from("disenos")
      .upload(fileName, file.buffer, { contentType: "text/plain", upsert: true });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = supabase.storage.from("disenos").getPublicUrl(fileName);

    const { error: dbError } = await supabase
      .from("diseno")
      .update({ archivo_url: publicUrl.publicUrl })
      .eq("id_diseno", id_diseno);

    if (dbError) throw dbError;

    res.json({
      message: "✅ Archivo G-code subido y vinculado al diseño",
      archivo_url: publicUrl.publicUrl
    });
  } catch (err) {
    console.error("❌ Error al subir archivo:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 7️⃣ Enviar comando a una CNC conectada
// ===============================
app.post("/send/:uuid", (req, res) => {
  const { uuid } = req.params;
  const { command } = req.body;

  const client = cncClients.get(uuid);
  if (!client) return res.status(404).json({ message: "CNC no conectada" });

  client.send(JSON.stringify({ type: "command", command }));
  res.json({ message: `Comando enviado a ${uuid}` });
});
