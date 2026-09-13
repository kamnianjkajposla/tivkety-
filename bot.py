import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import discord
from discord.ui import Button, View

# --- CZĘŚĆ 1: Mini serwer HTTP (żeby Render widział usługę sieciową) ---
class SimpleHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Bot dziala poprawnie!")

def run_web_server():
    port = int(os.environ.get("PORT", 10000))
    server = HTTPServer(('0.0.0.0', port), SimpleHandler)
    print(f"Uruchomiono serwer HTTP na porcie {port}")
    server.serve_forever()

# Uruchamiamy serwer HTTP w osobnym wątku, żeby nie blokował bota Discorda
web_thread = threading.Thread(target=run_web_server)
web_thread.daemon = True
web_thread.start()

# --- CZĘŚĆ 2: Właściwy kod bota Discorda ---
intents = discord.Intents.default()
intents.members = True  # Wymagane do zarządzania członkami

client = discord.Client(intents=intents)

class VerifyView(View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Zweryfikuj się", style=discord.ButtonStyle.green, custom_id="verify_button")
    async def verify(self, interaction: discord.Interaction, button: Button):
        role_id = 123456789012345678  # <-- Zastąp swoim ID roli "Zweryfikowany"
        role = interaction.guild.get_role(role_id)
        
        if role:
            await interaction.user.add_roles(role)
            await interaction.response.send_message("Pomyślnie zweryfikowano!", ephemeral=True)
        else:
            await interaction.response.send_message("Nie znaleziono roli weryfikacji.", ephemeral=True)

@client.event
async def on_ready():
    client.add_view(VerifyView())
    print(f"Zalogowano jako {client.user}")

# Uruchomienie bota
client.run(os.getenv("DISCORD_TOKEN"))
