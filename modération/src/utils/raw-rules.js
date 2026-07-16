const RAW_RULES = [
  "**Respect & Comportement :** Reste correct avec tout le monde. L'irrespect gratuit sera sanctionné.",
  "**Humour & Vannes :** L'humour et le second degré sont autorisés. Si vous vous lancez des vannes (même avec des insultes), il faut que tout le monde soit d'accord.",
  "**Humour Noir :** Autorisé, mais attention à la limite. Pas de haine déguisée, pas de N-word ou autres dérapages.",
  "**Contenus Interdits :** Le contenu gore / sang et le contenu sexuel (messages, images, vidéos, PFP, etc.) sont strictement interdits.",
  "**Harcèlement & Discrimination :** Tolérance zéro. Ban définitif direct.",
  "**Dox & Menaces de dox :** Strictement interdit. À la moindre menace ou insinuation, c'est ban définitif instantané.",
  "**Drague :** interdit (pour des raisons logiques).",
  '**Identité & Pseudos :** Interdiction des pseudos/profils de protestation type "BOYCOTT [Membre]" ou "Libérez [Membre]".',
  "**Insultes visées :** Un gros mot lâché comme ça, au pire on supprime. Mais viser et insulter quelqu'un ou se moquer méchamment, c'est interdit.",
  "**Religions & Politiques :** Fortement déconseillé. Si ça part en drama, ça va vous porter malheur.",
  "**Gestion des embrouilles :** Les disputes sont interdites. On s'en fout de qui a raison : tous les participants seront sanctionnés.",
];

const RULE_CHOICES = RAW_RULES.map((rule, index) => ({
  name: rule.length > 100 ? `${rule.substring(0, 97)}...` : rule,
  value: `${index}`,
}));

function getRuleByIndex(index) {
  return RAW_RULES[index] ?? null;
}

function getAutocompleteChoices(focusedValue) {
  return RULE_CHOICES.filter((choice) =>
    choice.name.toLowerCase().includes(focusedValue),
  ).slice(0, 25);
}

module.exports = {
  RAW_RULES,
  RULE_CHOICES,
  getRuleByIndex,
  getAutocompleteChoices,
};
