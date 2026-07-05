const path = require('node:path');
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    AttachmentBuilder,
    ContainerBuilder,
    MediaGalleryBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');

// Accent rouge aligné sur les bannières.
const RED = 0x8b1e1e;

const ASSETS = path.join(__dirname, '..', 'assets', 'reglement');

/** Une section = une bannière (image = titre) + un bloc de texte. */
const SECTIONS = [
    {
        banner: 'banner-reglement.png',
        text: [
            '## <a:Attention02:1523360529928949912>  Règlement de BLZSTARSS  <a:Attention02:1523360529928949912>',
            '',
            '> <a:Fgdroite03:1523361123871756439>  À lire et à respecter **dès ton arrivée** sur le serveur.',
            '> ',
            "> <a:Fgdroite03:1523361123871756439>  On est là pour **kiffer** — c'est pas une dictature, mais la modération se réserve le droit de trancher si tu abuses. Le règlement est **non-exhaustif** : fais preuve de logique.",
            '> ',
            '> <a:Fgdroite03:1523361123871756439>  Certaines informations liées aux sanctions peuvent être conservées en interne pour la sécurité du serveur.',
            '',
            '-# Installe-toi bien, reste chill et respecte les règles pour garder une bonne ambiance !',
            '',
            '### 🔰 De manière générale',
            "> * **Respect & Comportement :** Reste correct avec tout le monde. L'irrespect gratuit sera sanctionné. <:_triste:1289517443084980314>",
            "> * **Humour & Vannes :** L'humour et le second degré sont autorisés. Si vous vous lancez des vannes (même avec des insultes), il faut que **tout le monde soit d'accord**. <:_ok:1259913904755183788>",
            '> * **Humour Noir :** Autorisé, mais attention à la limite. Pas de haine déguisée, pas de N-word ou autres dérapages. <:_bruh:1254070952703168543>',
            '> * **Contenus Interdits :** Le contenu **gore / sang** et le contenu **sexuel** (messages, images, vidéos, PFP, etc.) sont strictement **interdits**.',
            '> * **Harcèlement & Discrimination :** Tolérance zéro. **Ban définitif direct**.',
            '> * **Drague :** **interdit** (pour des raisons logiques).',
            '> * **Identité & Pseudos :** Interdiction des pseudos/profils de protestation type "BOYCOTT [Membre]" ou "Libérez [Membre]".',
            '',
            '### 💬 Disputes & Conflits',
            "> * **Insultes visées :** Un gros mot lâché comme ça, au pire on supprime. Mais **viser et insulter quelqu'un** ou se moquer méchamment, c'est interdit.",
            '> * **Religions & Politiques :** Fortement déconseillé. Si ça part en drama, ça va vous porter malheur. <:_bruh:1254070952703168543>',
            '> * **Gestion des embrouilles :** Les disputes sont interdites. On s\'en fout de qui a raison : **tous les participants seront sanctionnés**. <:_triste:1289517443084980314>',
            '',
            '### 📢 Informations complémentaires',
            '> * Pour ouvrir un ticket et contacter le staff, suis les infos en <#1454477715494404212>. <:_ecrire:1259913886488989759>',
            '> * Seuls les modérateurs font respecter le règlement. Mentionne-en un au lieu de faire le travail toi-même. <:_ok:1259913904755183788>',
            '',
            '### ⚠️ Système de Sanctions (Warns)',
            '> Chaque sanction reçue te donne un **warn**. Un warn expire automatiquement au bout de **60 jours**.',
            '> * **1 warn :** Rien',
            '> * **2 warns :** Rien',
            '> * **3 warns :** 1 jour de mute',
            '> * **4 warns :** 1 semaine de mute',
            '> * **5 warns :** Ban définitif',
        ].join('\n'),
    },
    {
        banner: 'banner-fonctionnalites.png',
        text: [
            'Voici la liste des fonctionnalités majeures du serveur ainsi que la hiérarchie et les différents rôles !',
            '',
            '### 🛡️ Hiérarchie du Staff',
            '> <@&1433460236470980608> : Créateur et Fondateur suprême du serveur.',
            '> <@&1433460248789778524> : Co-fondateur et bras droit.',
            '> <@&1452608223634001940> : Gestion globale et technique du serveur.',
            "> <@&1452608118998433864> : Supervise l'équipe de modération.",
            '> <@&1452608041454407711> : Modérateurs officiels du serveur.',
            '> <@&1433460304041218150> : Modérateurs en période de test.',
            '',
            '### 🛡️ Sécurité & Vérification',
            '> * **<@&1400457540386422916> :** attribué aléatoirement aux nouveaux arrivants ou profils douteux. Il coupe l\'accès à tout le serveur sauf les salons de vérification.',
            '> * Une fois la procédure validée, ce rôle saute et tu obtiens **<@&1423410922482958388>** pour accéder à l\'ensemble du serveur !',
        ].join('\n'),
    },
    {
        banner: 'banner-ranked.png',
        text: [
            'Ton activité sur le serveur détermine ton niveau et ton grade ! Plus tu parles, plus tu montes.',
            '',
            '### 📊 Liste des Rangs (du plus bas au plus haut)',
            '> 🟢 <@&1515118847009755196>',
            '> 🟤 <@&1515118844627128442>',
            '> ⚪ <@&1515114241735000257>',
            '> 🟡 <@&1515114240267124791>',
            '> 🔵 <@&1515114237318660096> *(début de la perte d\'activité)*',
            '> 🟢 <@&1515119459293986920>',
            '> 🔴 <@&1515119397566546096>',
            '> 🟣 <@&1515119395939156139>',
            '> 🟠 <@&1515119395121135756>',
            '> ⚫ <@&1515119394420686898>',
            '> 🔥 <@&1515119389018558464>',
            '> ⭐ <@&1515119392118013972>',
            '',
            '### ⚙️ Paliers & Activité',
            '> * **Paliers :** du rang **Plastique** au rang **Légendaire**, chaque grade a des sous-paliers (ex: Or 1, Or 2, Or 3). À partir de **Légendaire et au-dessus**, il n\'y a plus qu\'un seul grade global par rôle.',
            '> * **Maintien du rang :** à partir du grade **Diamant**, tu dois rester actif. Sans participation, un système de decay te fera baisser petit à petit. Reste actif pour garder ton prestige !',
        ].join('\n'),
    },
    {
        banner: 'banner-bonus.png',
        accept: true,
        text: [
            'Soutiens le serveur ou obtiens des distinctions exclusives pour débloquer des permissions majeures !',
            '',
            '### 👑 Avantages VIP & Exclusifs',
            'En possédant les rôles **<@&1170361439345704962>** ou **<@&1323305704932507648>**, tu débloques immédiatement :',
            '> * 💬 L\'accès direct et exclusif au salon **Chat VIP**.',
            '> * 🖼️ La permission d\'envoyer des **GIFs** pour animer les discussions.',
            '> * 🛠️ **Rôle Perso :** si tu boostes activement et deviens VIP, tu peux demander la création d\'un **rôle personnalisé unique** !',
        ].join('\n'),
    },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reglement-publier')
        .setDescription('Publie le règlement officiel (4 sections avec bannières + bouton accepter).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption((o) =>
            o
                .setName('salon')
                .setDescription('Salon où publier (par défaut : salon actuel).')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false),
        ),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: "Tu n'as pas la permission d'utiliser cette commande.",
                flags: MessageFlags.Ephemeral,
            });
        }

        const channel = interaction.options.getChannel('salon') || interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            return interaction.reply({
                content: 'Salon invalide.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const me = interaction.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
            return interaction.reply({
                content: `Je ne peux pas écrire dans ${channel}.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            for (const section of SECTIONS) {
                const file = new AttachmentBuilder(path.join(ASSETS, section.banner), {
                    name: section.banner,
                });

                const container = new ContainerBuilder()
                    .setAccentColor(RED)
                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems({
                            media: { url: `attachment://${section.banner}` },
                        }),
                    )
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(section.text));

                if (section.accept) {
                    container.addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('accept_reglement')
                                .setLabel('✅ Accepter le règlement')
                                .setStyle(ButtonStyle.Success),
                        ),
                    );
                }

                await channel.send({
                    files: [file],
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                });
            }

            await interaction.editReply({
                content: `✅ Règlement publié dans ${channel}.`,
            });
        } catch (error) {
            console.error('Erreur reglement-publier:', error);
            await interaction.editReply({
                content: `❌ Une erreur est survenue : ${error.message}`,
            });
        }
    },
};
