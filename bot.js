import os
import discord
from discord.ui import Button, View

intents = discord.Intents.default()
intents.members = True  # Wymagane do zarządzania członkami

client = discord.Client(intents=intents)

class VerifyView(View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Zweryfikuj się", style=discord.ButtonStyle.green, custom_id="verify_button")
    async def verify(self, interaction: discord.Interaction, button: Button):
        role_id = 123456789012345678  # Zmień na ID swojej roli "Zweryfikowany"
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

# Uruchomienie bota za pomocą tokena ze zmiennej środowiskowej
client.run(os.getenv("DISCORD_TOKEN"))
