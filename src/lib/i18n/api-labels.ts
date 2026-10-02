/**
 * Interface labels of the API reference panel and Try it playground, per
 * locale. English is the source and the fallback; a locale missing a label
 * shows the English one. `{n}` is replaced with a count.
 */
const en = {
  parameters: 'Parameters',
  pathParameters: 'Path parameters',
  queryParameters: 'Query parameters',
  headers: 'Headers',
  cookieParameters: 'Cookie parameters',
  authorizations: 'Authorizations',
  authorization: 'Authorization',
  requestBody: 'Request body',
  responses: 'Responses',
  servers: 'Servers',
  tryIt: 'Try it',
  send: 'Send',
  sending: 'Sending',
  confirmDelete: 'Confirm delete',
  required: 'required',
  requiredCap: 'Required',
  optional: 'Optional',
  deprecated: 'deprecated',
  default: 'default',
  allowed: 'Allowed',
  allowedValue: 'Allowed value',
  noResponseBody: 'No response body.',
  request: 'Request',
  response: 'Response',
  result: 'Result',
  responseStatus: 'Response status',
  example: 'Example',
  webhook: 'Webhook',
  copy: 'Copy',
  copied: 'Copied!',
  close: 'Close',
  apiServer: 'API server',
  selectLanguage: 'Select language',
  selectExample: 'Select example',
  sendToPreview: 'Send a request to preview the response.',
  showChildAttributes: 'Show child attributes',
  properties: 'properties',
  variants: 'Variants',
  option: 'Option {n}',
  type: 'Type',
  body: 'Body',
  bearerPlaceholder: 'Enter bearer token',
  keyPlaceholder: 'Enter API key',
  showOptional: 'Show {n} optional fields',
  addItem: 'Add an item',
  remove: 'Remove',
  variant: 'variant',
  notValidJson: 'Not valid JSON',
  noServer: 'Select a server to build the URL',
}

export type ApiLabelKey = keyof typeof en

const translations: Record<string, Partial<Record<ApiLabelKey, string>>> = {
  es: {
    responseStatus: 'Estado de la respuesta',
    parameters: 'Parámetros', pathParameters: 'Parámetros de ruta', queryParameters: 'Parámetros de consulta', headers: 'Encabezados', cookieParameters: 'Parámetros de cookie',
    authorizations: 'Autorizaciones', authorization: 'Autorización', requestBody: 'Cuerpo de la solicitud', responses: 'Respuestas', servers: 'Servidores',
    tryIt: 'Pruébalo', send: 'Enviar', sending: 'Enviando', confirmDelete: 'Confirmar eliminación', required: 'requerido', requiredCap: 'Requerido', optional: 'Opcional',
    deprecated: 'obsoleto', default: 'predeterminado', allowed: 'Permitido', allowedValue: 'Valor permitido', noResponseBody: 'Sin cuerpo de respuesta.',
    request: 'Solicitud', response: 'Respuesta', result: 'Resultado', example: 'Ejemplo', webhook: 'Webhook', copy: 'Copiar', copied: '¡Copiado!', close: 'Cerrar',
    apiServer: 'Servidor de la API', selectLanguage: 'Seleccionar lenguaje', selectExample: 'Seleccionar ejemplo', sendToPreview: 'Envía una solicitud para ver la respuesta.',
    showChildAttributes: 'Mostrar atributos secundarios', properties: 'propiedades', variants: 'Variantes', option: 'Opción {n}', type: 'Tipo', body: 'Cuerpo',
    bearerPlaceholder: 'Introduce el token bearer', keyPlaceholder: 'Introduce la clave de API', showOptional: 'Mostrar {n} campos opcionales', addItem: 'Añadir un elemento',
    remove: 'Quitar', variant: 'variante', notValidJson: 'JSON no válido', noServer: 'Selecciona un servidor para construir la URL',
  },
  fr: {
    responseStatus: 'Statut de la réponse',
    parameters: 'Paramètres', pathParameters: 'Paramètres de chemin', queryParameters: 'Paramètres de requête', headers: 'En-têtes', cookieParameters: 'Paramètres de cookie',
    authorizations: 'Autorisations', authorization: 'Autorisation', requestBody: 'Corps de la requête', responses: 'Réponses', servers: 'Serveurs',
    tryIt: 'Essayer', send: 'Envoyer', sending: 'Envoi', confirmDelete: 'Confirmer la suppression', required: 'requis', requiredCap: 'Requis', optional: 'Facultatif',
    deprecated: 'obsolète', default: 'par défaut', allowed: 'Autorisé', allowedValue: 'Valeur autorisée', noResponseBody: 'Pas de corps de réponse.',
    request: 'Requête', response: 'Réponse', result: 'Résultat', example: 'Exemple', webhook: 'Webhook', copy: 'Copier', copied: 'Copié !', close: 'Fermer',
    apiServer: "Serveur de l'API", selectLanguage: 'Choisir le langage', selectExample: 'Choisir un exemple', sendToPreview: 'Envoyez une requête pour voir la réponse.',
    showChildAttributes: 'Afficher les attributs enfants', properties: 'propriétés', variants: 'Variantes', option: 'Option {n}', type: 'Type', body: 'Corps',
    bearerPlaceholder: 'Saisissez le jeton bearer', keyPlaceholder: "Saisissez la clé d'API", showOptional: 'Afficher {n} champs facultatifs', addItem: 'Ajouter un élément',
    remove: 'Retirer', variant: 'variante', notValidJson: 'JSON non valide', noServer: 'Sélectionnez un serveur pour construire l’URL',
  },
  ja: {
    responseStatus: 'レスポンスステータス',
    parameters: 'パラメータ', pathParameters: 'パスパラメータ', queryParameters: 'クエリパラメータ', headers: 'ヘッダー', cookieParameters: 'Cookie パラメータ',
    authorizations: '認証', authorization: '認証', requestBody: 'リクエストボディ', responses: 'レスポンス', servers: 'サーバー',
    tryIt: '試す', send: '送信', sending: '送信中', confirmDelete: '削除を確定', required: '必須', requiredCap: '必須', optional: '任意',
    deprecated: '非推奨', default: 'デフォルト', allowed: '許可される値', allowedValue: '許可される値', noResponseBody: 'レスポンスボディはありません。',
    request: 'リクエスト', response: 'レスポンス', result: '結果', example: '例', webhook: 'Webhook', copy: 'コピー', copied: 'コピーしました', close: '閉じる',
    apiServer: 'API サーバー', selectLanguage: '言語を選択', selectExample: '例を選択', sendToPreview: 'リクエストを送信するとレスポンスを確認できます。',
    showChildAttributes: '子属性を表示', properties: 'プロパティ', variants: 'バリアント', option: 'オプション {n}', type: '型', body: 'ボディ',
    bearerPlaceholder: 'ベアラートークンを入力', keyPlaceholder: 'API キーを入力', showOptional: '任意フィールド {n} 件を表示', addItem: '項目を追加',
    remove: '削除', variant: 'バリアント', notValidJson: '有効な JSON ではありません', noServer: 'サーバーを選択して URL を生成',
  },
  zh: {
    responseStatus: '响应状态',
    parameters: '参数', pathParameters: '路径参数', queryParameters: '查询参数', headers: '请求头', cookieParameters: 'Cookie 参数',
    authorizations: '授权', authorization: '授权', requestBody: '请求体', responses: '响应', servers: '服务器',
    tryIt: '试一试', send: '发送', sending: '发送中', confirmDelete: '确认删除', required: '必填', requiredCap: '必填', optional: '可选',
    deprecated: '已弃用', default: '默认值', allowed: '允许的值', allowedValue: '允许的值', noResponseBody: '无响应体。',
    request: '请求', response: '响应', result: '结果', example: '示例', webhook: 'Webhook', copy: '复制', copied: '已复制', close: '关闭',
    apiServer: 'API 服务器', selectLanguage: '选择语言', selectExample: '选择示例', sendToPreview: '发送请求以预览响应。',
    showChildAttributes: '显示子属性', properties: '属性', variants: '变体', option: '选项 {n}', type: '类型', body: '请求体',
    bearerPlaceholder: '输入 Bearer 令牌', keyPlaceholder: '输入 API 密钥', showOptional: '显示 {n} 个可选字段', addItem: '添加一项',
    remove: '移除', variant: '变体', notValidJson: '不是有效的 JSON', noServer: '请选择服务器以生成 URL',
  },
  'pt-BR': {
    responseStatus: 'Status da resposta',
    parameters: 'Parâmetros', pathParameters: 'Parâmetros de caminho', queryParameters: 'Parâmetros de consulta', headers: 'Cabeçalhos', cookieParameters: 'Parâmetros de cookie',
    authorizations: 'Autorizações', authorization: 'Autorização', requestBody: 'Corpo da requisição', responses: 'Respostas', servers: 'Servidores',
    tryIt: 'Experimente', send: 'Enviar', sending: 'Enviando', confirmDelete: 'Confirmar exclusão', required: 'obrigatório', requiredCap: 'Obrigatório', optional: 'Opcional',
    deprecated: 'obsoleto', default: 'padrão', allowed: 'Permitido', allowedValue: 'Valor permitido', noResponseBody: 'Sem corpo de resposta.',
    request: 'Requisição', response: 'Resposta', result: 'Resultado', example: 'Exemplo', webhook: 'Webhook', copy: 'Copiar', copied: 'Copiado!', close: 'Fechar',
    apiServer: 'Servidor da API', selectLanguage: 'Selecionar linguagem', selectExample: 'Selecionar exemplo', sendToPreview: 'Envie uma requisição para ver a resposta.',
    showChildAttributes: 'Mostrar atributos filhos', properties: 'propriedades', variants: 'Variantes', option: 'Opção {n}', type: 'Tipo', body: 'Corpo',
    bearerPlaceholder: 'Insira o token bearer', keyPlaceholder: 'Insira a chave da API', showOptional: 'Mostrar {n} campos opcionais', addItem: 'Adicionar um item',
    remove: 'Remover', variant: 'variante', notValidJson: 'JSON inválido', noServer: 'Selecione um servidor para montar a URL',
  },
}

/** `zh-Hans` and `zh-CN` use `zh`; a bare `pt` uses `pt-BR`. */
function table(locale?: string) {
  if (!locale) return undefined
  if (translations[locale]) return translations[locale]
  const base = locale.split('-')[0]
  return translations[base] ?? (base === 'pt' ? translations['pt-BR'] : undefined)
}

export function apiLabel(locale: string | undefined, key: ApiLabelKey, n?: number): string {
  const text = table(locale)?.[key] ?? en[key]
  return n === undefined ? text : text.replace('{n}', String(n))
}
