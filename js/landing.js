/* ══════════════════════════════════════════════════════════════
   STREAMLY LANDING — JavaScript
   Currency switcher, i18n, Stripe checkout, FAQ toggle
   ══════════════════════════════════════════════════════════════ */

// ── Currency Data ──
// Base price: 99 MXN. Rates are approximate and updated periodically.
const BASE_PRICE_MXN = 99;
const CURRENCIES = {
  MXN: { symbol: '$',  code: 'MXN', rate: 1,       decimals: 0 },
  USD: { symbol: '$',  code: 'USD', rate: 0.057,    decimals: 2 },
  EUR: { symbol: '€',  code: 'EUR', rate: 0.052,    decimals: 2 },
  BRL: { symbol: 'R$', code: 'BRL', rate: 0.29,     decimals: 2 },
  GBP: { symbol: '£',  code: 'GBP', rate: 0.044,    decimals: 2 },
  COP: { symbol: '$',  code: 'COP', rate: 236,      decimals: 0 },
  ARS: { symbol: '$',  code: 'ARS', rate: 60,       decimals: 0 },
};

let currentCurrency = 'MXN';

function setCurrency(code) {
  if (!CURRENCIES[code]) return;
  currentCurrency = code;
  const cur = CURRENCIES[code];
  const price = BASE_PRICE_MXN * cur.rate;
  const formatted = cur.decimals === 0 ? Math.round(price) : price.toFixed(cur.decimals);

  document.getElementById('priceCurrencySymbol').textContent = cur.symbol;
  document.getElementById('priceAmount').textContent = formatted;
  document.getElementById('priceCurrencyCode').textContent = cur.code;

  // Update CTA button text with price
  const ctaAmountText = `${cur.symbol}${formatted} ${cur.code}`;
  const ctaKey = 'cta.subscribe';
  // Update the final CTA button that shows price
  document.querySelectorAll('[data-i18n="cta.subscribe"]').forEach(el => {
    const tpl = landingT('cta.subscribe_tpl', 'Suscribirme por {price}/mes');
    el.textContent = tpl.replace('{price}', ctaAmountText);
  });

  // Active state
  document.querySelectorAll('.currency-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.currency === code);
  });
}

// ── FAQ Toggle ──
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const isOpen = item.classList.contains('open');
  // Close all
  document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

// ── Mobile Menu ──
function toggleMobileMenu() {
  document.getElementById('navLinks').classList.toggle('open');
}

// Close mobile menu on link click
document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', () => {
    document.getElementById('navLinks').classList.remove('open');
  });
});

// ── Stripe Checkout ──
async function startCheckout() {
  const btn = document.getElementById('subscribeBtn');
  if (!btn) return;
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + landingT('pricing.processing', 'Procesando...');

  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: currentCurrency.toLowerCase() })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error creating checkout session');
    }

    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error('No checkout URL returned');
    }
  } catch (err) {
    console.error('Checkout error:', err);
    alert(landingT('pricing.error', 'Error al procesar el pago. Inténtalo de nuevo.'));
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ══════════════════════════════════════
// LANDING i18n (standalone, no dependency on main i18n.js)
// ══════════════════════════════════════
const LANDING_LANGS = ['es', 'en', 'pt', 'fr'];
let landingLang = localStorage.getItem('streamly_lang') || 'es';

const landingTranslations = {
  es: {
    'nav.features': 'Características',
    'nav.how': 'Cómo funciona',
    'nav.pricing': 'Precios',
    'nav.faq': 'FAQ',
    'nav.login': 'Iniciar Sesión',
    'hero.badge': '🚀 Plataforma todo-en-uno',
    'hero.title1': 'Gestiona cuentas.',
    'hero.title2': 'Automatiza WhatsApp.',
    'hero.title3': 'Crece tu negocio.',
    'hero.subtitle': 'Streamly centraliza la gestión de tus cuentas de streaming, clientes, cobros y un bot de WhatsApp con IA — todo desde un solo panel.',
    'hero.cta_start': 'Comenzar Ahora',
    'hero.cta_learn': 'Ver más',
    'hero.stat_price': '/mes — plan único',
    'hero.stat_bot': 'Bot WhatsApp activo',
    'hero.stat_clients': 'Clientes ilimitados',
    'platforms.label': 'Compatible con las principales plataformas de streaming',
    'features.badge': 'Características',
    'features.title': 'Todo lo que necesitas para gestionar tu negocio',
    'features.subtitle': 'Desde el control de cuentas hasta la automatización de cobros con IA',
    'features.f1_title': 'Gestión de Cuentas',
    'features.f1_desc': 'Administra todas tus cuentas de streaming en un solo lugar. Netflix, Spotify, Disney+, y mucho más. Agrega perfiles, contraseñas y fechas de vencimiento.',
    'features.f2_title': 'Control de Clientes',
    'features.f2_desc': 'Ficha completa por cliente: datos de contacto, plataforma asignada, fecha de pago, estado activo/inactivo. Nunca pierdas el control.',
    'features.f3_title': 'Reportes y Métricas',
    'features.f3_desc': 'Visualiza ingresos, egresos, clientes activos y ganancias netas. Gráficas en tiempo real para tomar mejores decisiones.',
    'features.f4_title': 'Bot WhatsApp con IA',
    'features.f4_desc': 'Bot inteligente que responde automáticamente a tus clientes. Configuración personalizada, tono de voz, respuestas con Gemini AI.',
    'features.f4_badge': '⭐ Más popular',
    'features.f5_title': 'Mensajes Programados',
    'features.f5_desc': 'Programa mensajes a cualquier grupo de WhatsApp. Una sola vez o recurrentes. Ideal para recordatorios de pago.',
    'features.f6_title': 'Gestión de Movimientos',
    'features.f6_desc': 'Registra ingresos y egresos vinculados a clientes. Exporta datos, filtra por fecha y mantén tu contabilidad al día.',
    'features.f7_title': 'Inventario de Cuentas',
    'features.f7_desc': 'Visualiza cuántas cuentas tienes disponibles y cuántas están asignadas. Control total del stock.',
    'features.f8_title': 'Multi-idioma',
    'features.f8_desc': 'Interfaz traducida a Español, Inglés, Portugués y Francés. Perfecto para negocios internacionales.',
    'how.badge': 'Cómo funciona',
    'how.title': 'Empieza en 3 simples pasos',
    'how.s1_title': 'Crea tu cuenta',
    'how.s1_desc': 'Regístrate en segundos. No necesitas tarjeta de crédito para explorar.',
    'how.s2_title': 'Configura tu negocio',
    'how.s2_desc': 'Agrega cuentas de streaming, importa clientes y configura tu bot con nuestro asistente IA.',
    'how.s3_title': '¡Automatiza y crece!',
    'how.s3_desc': 'Tu bot responde clientes, los recordatorios se envían solos. Enfócate en crecer.',
    'pricing.badge': 'Precios',
    'pricing.title': 'Un solo plan. Todo incluido.',
    'pricing.subtitle': 'Sin sorpresas, sin costos ocultos. Todo por un precio simple.',
    'pricing.see_in': 'Ver precio en:',
    'pricing.plan_name': 'Plan Completo',
    'pricing.month': 'mes',
    'pricing.note': 'Cancela cuando quieras. Sin contratos.',
    'pricing.pf1': 'Cuentas de streaming ilimitadas',
    'pricing.pf2': 'Clientes ilimitados',
    'pricing.pf3': 'Bot WhatsApp con IA (Gemini)',
    'pricing.pf4': 'Mensajes programados a grupos',
    'pricing.pf5': 'Reportes y métricas en tiempo real',
    'pricing.pf6': 'Gestión de movimientos financieros',
    'pricing.pf7': 'Inventario de cuentas disponibles',
    'pricing.pf8': 'Multi-idioma (ES, EN, PT, FR)',
    'pricing.pf9': 'Actualizaciones gratuitas',
    'pricing.pf10': 'Soporte prioritario',
    'pricing.subscribe': 'Suscribirme ahora',
    'pricing.secure': 'Pago seguro con Stripe',
    'pricing.processing': 'Procesando...',
    'pricing.error': 'Error al procesar el pago. Inténtalo de nuevo.',
    'cta.title': '¿Listo para transformar tu negocio?',
    'cta.subtitle': 'Únete a Streamly hoy y lleva tu gestión al siguiente nivel.',
    'cta.subscribe_tpl': 'Suscribirme por {price}/mes',
    'cta.login': 'Ya tengo cuenta → Entrar',
    'faq.title': 'Preguntas Frecuentes',
    'faq.q1': '¿Necesito conocimientos técnicos para usar Streamly?',
    'faq.a1': 'No. Streamly está diseñado para ser intuitivo. El asistente de IA te guía paso a paso.',
    'faq.q2': '¿Cómo funciona el bot de WhatsApp?',
    'faq.a2': 'Conectas tu WhatsApp escaneando un QR. El bot usa Gemini AI para responder según tus instrucciones: tono, horario, precios, etc.',
    'faq.q3': '¿Puedo cancelar en cualquier momento?',
    'faq.a3': 'Sí. Sin contratos. Cancela desde Stripe y mantén acceso hasta fin de tu periodo.',
    'faq.q4': '¿Qué plataformas de streaming soporta?',
    'faq.a4': 'Cualquiera: Netflix, Spotify, Disney+, HBO Max, Amazon Prime, YouTube Premium, Crunchyroll, y más.',
    'faq.q5': '¿Es seguro?',
    'faq.a5': 'Sí. Firebase Auth, datos encriptados, aislamiento por usuario. Los pagos los procesa Stripe directamente.',
    'faq.q6': '¿Funciona en mi país?',
    'faq.a6': 'Sí. Funciona globalmente. Puedes ver precios en tu moneda local y el bot opera en cualquier país.',
    'footer.desc': 'Plataforma todo-en-uno para gestionar cuentas de streaming y automatizar WhatsApp con IA.',
    'footer.product': 'Producto',
    'footer.account': 'Cuenta',
    'footer.register': 'Registrarse',
    'footer.legal': 'Legal',
    'footer.privacy': 'Privacidad',
    'footer.terms': 'Términos',
    'footer.rights': 'Todos los derechos reservados.',
  },
  en: {
    'nav.features': 'Features',
    'nav.how': 'How it works',
    'nav.pricing': 'Pricing',
    'nav.faq': 'FAQ',
    'nav.login': 'Log In',
    'hero.badge': '🚀 All-in-one platform',
    'hero.title1': 'Manage accounts.',
    'hero.title2': 'Automate WhatsApp.',
    'hero.title3': 'Grow your business.',
    'hero.subtitle': 'Streamly centralizes your streaming account management, clients, billing and a WhatsApp AI bot — all from one dashboard.',
    'hero.cta_start': 'Get Started',
    'hero.cta_learn': 'Learn more',
    'hero.stat_price': '/mo — single plan',
    'hero.stat_bot': 'WhatsApp Bot 24/7',
    'hero.stat_clients': 'Unlimited clients',
    'platforms.label': 'Compatible with major streaming platforms',
    'features.badge': 'Features',
    'features.title': 'Everything you need to manage your business',
    'features.subtitle': 'From account management to AI-powered billing automation',
    'features.f1_title': 'Account Management',
    'features.f1_desc': 'Manage all your streaming accounts in one place. Netflix, Spotify, Disney+, and more. Track credentials and expiry dates.',
    'features.f2_title': 'Client Control',
    'features.f2_desc': 'Full client profiles: contact info, assigned platform, payment date, active/inactive status. Never lose track.',
    'features.f3_title': 'Reports & Metrics',
    'features.f3_desc': 'View income, expenses, active clients and net profit. Real-time charts for better business decisions.',
    'features.f4_title': 'WhatsApp AI Bot',
    'features.f4_desc': 'Smart bot that auto-replies to customers. Custom configuration, tone of voice, context-aware responses with Gemini AI.',
    'features.f4_badge': '⭐ Most popular',
    'features.f5_title': 'Scheduled Messages',
    'features.f5_desc': 'Schedule messages to any WhatsApp group. One-time or recurring. Perfect for payment reminders and promotions.',
    'features.f6_title': 'Financial Tracking',
    'features.f6_desc': 'Record income and expenses linked to clients. Export data, filter by date and keep your books up to date.',
    'features.f7_title': 'Account Inventory',
    'features.f7_desc': 'See how many accounts are available and assigned. Full stock control so you never run out of slots.',
    'features.f8_title': 'Multi-language',
    'features.f8_desc': 'Interface fully translated to Spanish, English, Portuguese and French. Perfect for international businesses.',
    'how.badge': 'How it works',
    'how.title': 'Get started in 3 easy steps',
    'how.s1_title': 'Create your account',
    'how.s1_desc': 'Sign up in seconds. No credit card needed to explore the platform.',
    'how.s2_title': 'Set up your business',
    'how.s2_desc': 'Add streaming accounts, import clients and configure your WhatsApp bot with our AI assistant.',
    'how.s3_title': 'Automate & grow!',
    'how.s3_desc': 'Your bot handles clients, reminders send themselves. Focus on growing your business.',
    'pricing.badge': 'Pricing',
    'pricing.title': 'One plan. Everything included.',
    'pricing.subtitle': 'No surprises, no hidden fees. Everything you need at one simple price.',
    'pricing.see_in': 'See price in:',
    'pricing.plan_name': 'Complete Plan',
    'pricing.month': 'mo',
    'pricing.note': 'Cancel anytime. No contracts.',
    'pricing.pf1': 'Unlimited streaming accounts',
    'pricing.pf2': 'Unlimited clients',
    'pricing.pf3': 'WhatsApp AI Bot (Gemini)',
    'pricing.pf4': 'Scheduled group messages',
    'pricing.pf5': 'Real-time reports & metrics',
    'pricing.pf6': 'Financial movement tracking',
    'pricing.pf7': 'Account inventory management',
    'pricing.pf8': 'Multi-language (ES, EN, PT, FR)',
    'pricing.pf9': 'Free updates',
    'pricing.pf10': 'Priority support',
    'pricing.subscribe': 'Subscribe now',
    'pricing.secure': 'Secure payment with Stripe',
    'pricing.processing': 'Processing...',
    'pricing.error': 'Payment error. Please try again.',
    'cta.title': 'Ready to transform your business?',
    'cta.subtitle': 'Join Streamly today and take your account management to the next level.',
    'cta.subscribe_tpl': 'Subscribe for {price}/mo',
    'cta.login': 'I have an account → Log in',
    'faq.title': 'Frequently Asked Questions',
    'faq.q1': 'Do I need technical knowledge to use Streamly?',
    'faq.a1': 'No. Streamly is designed to be intuitive. The AI assistant guides you step by step.',
    'faq.q2': 'How does the WhatsApp bot work?',
    'faq.a2': 'Connect your WhatsApp by scanning a QR code. The bot uses Gemini AI to auto-reply based on your instructions.',
    'faq.q3': 'Can I cancel anytime?',
    'faq.a3': 'Yes. No contracts. Cancel from Stripe and keep access until end of your billing period.',
    'faq.q4': 'What streaming platforms are supported?',
    'faq.a4': 'Any: Netflix, Spotify, Disney+, HBO Max, Amazon Prime, YouTube Premium, Crunchyroll, and more.',
    'faq.q5': 'Is it secure?',
    'faq.a5': 'Yes. Firebase Auth, encrypted data, per-user isolation. Payments processed directly by Stripe.',
    'faq.q6': 'Does it work in my country?',
    'faq.a6': 'Yes. Works globally. See prices in your local currency and the bot operates worldwide.',
    'footer.desc': 'All-in-one platform for streaming account management and WhatsApp AI automation.',
    'footer.product': 'Product',
    'footer.account': 'Account',
    'footer.register': 'Sign Up',
    'footer.legal': 'Legal',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'footer.rights': 'All rights reserved.',
  },
  pt: {
    'nav.features': 'Recursos',
    'nav.how': 'Como funciona',
    'nav.pricing': 'Preços',
    'nav.faq': 'FAQ',
    'nav.login': 'Entrar',
    'hero.badge': '🚀 Plataforma tudo-em-um',
    'hero.title1': 'Gerencie contas.',
    'hero.title2': 'Automatize WhatsApp.',
    'hero.title3': 'Cresça seu negócio.',
    'hero.subtitle': 'Streamly centraliza a gestão de contas de streaming, clientes, cobranças e um bot WhatsApp com IA — tudo em um painel.',
    'hero.cta_start': 'Começar Agora',
    'hero.cta_learn': 'Saiba mais',
    'hero.stat_price': '/mês — plano único',
    'hero.stat_bot': 'Bot WhatsApp 24/7',
    'hero.stat_clients': 'Clientes ilimitados',
    'platforms.label': 'Compatível com as principais plataformas de streaming',
    'features.badge': 'Recursos',
    'features.title': 'Tudo que você precisa para gerenciar seu negócio',
    'features.subtitle': 'Do controle de contas à automação de cobranças com IA',
    'features.f1_title': 'Gestão de Contas',
    'features.f1_desc': 'Gerencie todas as suas contas de streaming em um só lugar. Netflix, Spotify, Disney+ e mais.',
    'features.f2_title': 'Controle de Clientes',
    'features.f2_desc': 'Ficha completa por cliente: contato, plataforma, data de pagamento, status ativo/inativo.',
    'features.f3_title': 'Relatórios e Métricas',
    'features.f3_desc': 'Visualize receitas, despesas e lucro líquido. Gráficos em tempo real para melhores decisões.',
    'features.f4_title': 'Bot WhatsApp com IA',
    'features.f4_desc': 'Bot inteligente que responde automaticamente. Configuração personalizada com Gemini AI.',
    'features.f4_badge': '⭐ Mais popular',
    'features.f5_title': 'Mensagens Agendadas',
    'features.f5_desc': 'Agende mensagens para grupos do WhatsApp. Única ou recorrente. Ideal para lembretes de pagamento.',
    'features.f6_title': 'Gestão Financeira',
    'features.f6_desc': 'Registre receitas e despesas vinculadas a clientes. Exporte dados e mantenha a contabilidade em dia.',
    'features.f7_title': 'Inventário de Contas',
    'features.f7_desc': 'Veja quantas contas estão disponíveis e atribuídas. Controle total do estoque.',
    'features.f8_title': 'Multi-idioma',
    'features.f8_desc': 'Interface traduzida para Espanhol, Inglês, Português e Francês.',
    'how.badge': 'Como funciona',
    'how.title': 'Comece em 3 passos simples',
    'how.s1_title': 'Crie sua conta',
    'how.s1_desc': 'Cadastre-se em segundos. Sem cartão de crédito para explorar.',
    'how.s2_title': 'Configure seu negócio',
    'how.s2_desc': 'Adicione contas, importe clientes e configure o bot com nosso assistente IA.',
    'how.s3_title': 'Automatize e cresça!',
    'how.s3_desc': 'Seu bot atende clientes, lembretes se enviam sozinhos. Foque em crescer.',
    'pricing.badge': 'Preços',
    'pricing.title': 'Um plano. Tudo incluído.',
    'pricing.subtitle': 'Sem surpresas, sem custos ocultos. Tudo por um preço simples.',
    'pricing.see_in': 'Ver preço em:',
    'pricing.plan_name': 'Plano Completo',
    'pricing.month': 'mês',
    'pricing.note': 'Cancele quando quiser. Sem contratos.',
    'pricing.pf1': 'Contas de streaming ilimitadas',
    'pricing.pf2': 'Clientes ilimitados',
    'pricing.pf3': 'Bot WhatsApp com IA (Gemini)',
    'pricing.pf4': 'Mensagens agendadas para grupos',
    'pricing.pf5': 'Relatórios e métricas em tempo real',
    'pricing.pf6': 'Gestão de movimentos financeiros',
    'pricing.pf7': 'Inventário de contas disponíveis',
    'pricing.pf8': 'Multi-idioma (ES, EN, PT, FR)',
    'pricing.pf9': 'Atualizações gratuitas',
    'pricing.pf10': 'Suporte prioritário',
    'pricing.subscribe': 'Assinar agora',
    'pricing.secure': 'Pagamento seguro com Stripe',
    'pricing.processing': 'Processando...',
    'pricing.error': 'Erro no pagamento. Tente novamente.',
    'cta.title': 'Pronto para transformar seu negócio?',
    'cta.subtitle': 'Junte-se ao Streamly e leve sua gestão ao próximo nível.',
    'cta.subscribe_tpl': 'Assinar por {price}/mês',
    'cta.login': 'Já tenho conta → Entrar',
    'faq.title': 'Perguntas Frequentes',
    'faq.q1': 'Preciso de conhecimento técnico para usar o Streamly?',
    'faq.a1': 'Não. O Streamly é intuitivo. O assistente IA guia você passo a passo.',
    'faq.q2': 'Como funciona o bot do WhatsApp?',
    'faq.a2': 'Conecte seu WhatsApp escaneando um QR. O bot usa Gemini AI para responder conforme suas instruções.',
    'faq.q3': 'Posso cancelar a qualquer momento?',
    'faq.a3': 'Sim. Sem contratos. Cancele pelo Stripe e mantenha acesso até o fim do período.',
    'faq.q4': 'Quais plataformas de streaming são suportadas?',
    'faq.a4': 'Qualquer uma: Netflix, Spotify, Disney+, HBO Max, Amazon Prime, YouTube Premium e mais.',
    'faq.q5': 'É seguro?',
    'faq.a5': 'Sim. Firebase Auth, dados criptografados e isolamento por usuário. Pagamentos pelo Stripe.',
    'faq.q6': 'Funciona no meu país?',
    'faq.a6': 'Sim. Funciona globalmente. Veja preços na sua moeda local.',
    'footer.desc': 'Plataforma tudo-em-um para gestão de contas de streaming e automação WhatsApp com IA.',
    'footer.product': 'Produto',
    'footer.account': 'Conta',
    'footer.register': 'Cadastrar',
    'footer.legal': 'Legal',
    'footer.privacy': 'Privacidade',
    'footer.terms': 'Termos',
    'footer.rights': 'Todos os direitos reservados.',
  },
  fr: {
    'nav.features': 'Fonctionnalités',
    'nav.how': 'Comment ça marche',
    'nav.pricing': 'Tarifs',
    'nav.faq': 'FAQ',
    'nav.login': 'Se connecter',
    'hero.badge': '🚀 Plateforme tout-en-un',
    'hero.title1': 'Gérez vos comptes.',
    'hero.title2': 'Automatisez WhatsApp.',
    'hero.title3': 'Développez votre business.',
    'hero.subtitle': 'Streamly centralise la gestion de vos comptes streaming, clients, paiements et un bot WhatsApp IA — tout dans un seul tableau de bord.',
    'hero.cta_start': 'Commencer',
    'hero.cta_learn': 'En savoir plus',
    'hero.stat_price': '/mois — plan unique',
    'hero.stat_bot': 'Bot WhatsApp 24/7',
    'hero.stat_clients': 'Clients illimités',
    'platforms.label': 'Compatible avec les principales plateformes de streaming',
    'features.badge': 'Fonctionnalités',
    'features.title': 'Tout ce dont vous avez besoin pour gérer votre business',
    'features.subtitle': 'De la gestion des comptes à l\'automatisation des paiements avec l\'IA',
    'features.f1_title': 'Gestion des Comptes',
    'features.f1_desc': 'Gérez tous vos comptes streaming en un seul endroit. Netflix, Spotify, Disney+ et plus encore.',
    'features.f2_title': 'Contrôle Clients',
    'features.f2_desc': 'Fiche client complète : contact, plateforme, date de paiement, statut actif/inactif.',
    'features.f3_title': 'Rapports & Métriques',
    'features.f3_desc': 'Visualisez revenus, dépenses et bénéfice net. Graphiques en temps réel.',
    'features.f4_title': 'Bot WhatsApp IA',
    'features.f4_desc': 'Bot intelligent qui répond automatiquement. Configuration personnalisée avec Gemini AI.',
    'features.f4_badge': '⭐ Le plus populaire',
    'features.f5_title': 'Messages Programmés',
    'features.f5_desc': 'Programmez des messages à n\'importe quel groupe WhatsApp. Unique ou récurrent.',
    'features.f6_title': 'Gestion Financière',
    'features.f6_desc': 'Enregistrez revenus et dépenses liés aux clients. Exportez et filtrez par date.',
    'features.f7_title': 'Inventaire des Comptes',
    'features.f7_desc': 'Voyez combien de comptes sont disponibles et attribués. Contrôle total du stock.',
    'features.f8_title': 'Multi-langue',
    'features.f8_desc': 'Interface traduite en Espagnol, Anglais, Portugais et Français.',
    'how.badge': 'Comment ça marche',
    'how.title': 'Commencez en 3 étapes simples',
    'how.s1_title': 'Créez votre compte',
    'how.s1_desc': 'Inscrivez-vous en quelques secondes. Pas de carte bancaire requise.',
    'how.s2_title': 'Configurez votre business',
    'how.s2_desc': 'Ajoutez des comptes, importez des clients et configurez le bot avec notre assistant IA.',
    'how.s3_title': 'Automatisez et grandissez !',
    'how.s3_desc': 'Votre bot gère les clients, les rappels s\'envoient seuls. Concentrez-vous sur la croissance.',
    'pricing.badge': 'Tarifs',
    'pricing.title': 'Un seul plan. Tout inclus.',
    'pricing.subtitle': 'Pas de surprises, pas de frais cachés. Tout à un prix simple.',
    'pricing.see_in': 'Voir le prix en :',
    'pricing.plan_name': 'Plan Complet',
    'pricing.month': 'mois',
    'pricing.note': 'Annulez quand vous voulez. Sans engagement.',
    'pricing.pf1': 'Comptes streaming illimités',
    'pricing.pf2': 'Clients illimités',
    'pricing.pf3': 'Bot WhatsApp IA (Gemini)',
    'pricing.pf4': 'Messages programmés aux groupes',
    'pricing.pf5': 'Rapports & métriques en temps réel',
    'pricing.pf6': 'Suivi des mouvements financiers',
    'pricing.pf7': 'Inventaire des comptes disponibles',
    'pricing.pf8': 'Multi-langue (ES, EN, PT, FR)',
    'pricing.pf9': 'Mises à jour gratuites',
    'pricing.pf10': 'Support prioritaire',
    'pricing.subscribe': 'S\'abonner maintenant',
    'pricing.secure': 'Paiement sécurisé avec Stripe',
    'pricing.processing': 'Traitement...',
    'pricing.error': 'Erreur de paiement. Veuillez réessayer.',
    'cta.title': 'Prêt à transformer votre business ?',
    'cta.subtitle': 'Rejoignez Streamly et passez au niveau supérieur.',
    'cta.subscribe_tpl': 'S\'abonner pour {price}/mois',
    'cta.login': 'J\'ai déjà un compte → Entrer',
    'faq.title': 'Questions Fréquentes',
    'faq.q1': 'Ai-je besoin de connaissances techniques pour utiliser Streamly ?',
    'faq.a1': 'Non. Streamly est conçu pour être intuitif. L\'assistant IA vous guide étape par étape.',
    'faq.q2': 'Comment fonctionne le bot WhatsApp ?',
    'faq.a2': 'Connectez votre WhatsApp en scannant un QR. Le bot utilise Gemini AI pour répondre selon vos instructions.',
    'faq.q3': 'Puis-je annuler à tout moment ?',
    'faq.a3': 'Oui. Sans engagement. Annulez depuis Stripe et gardez l\'accès jusqu\'à la fin de votre période.',
    'faq.q4': 'Quelles plateformes de streaming sont supportées ?',
    'faq.a4': 'Toutes : Netflix, Spotify, Disney+, HBO Max, Amazon Prime, YouTube Premium et plus encore.',
    'faq.q5': 'Est-ce sécurisé ?',
    'faq.a5': 'Oui. Firebase Auth, données chiffrées, isolation par utilisateur. Paiements traités par Stripe.',
    'faq.q6': 'Ça fonctionne dans mon pays ?',
    'faq.a6': 'Oui. Fonctionne mondialement. Consultez les prix dans votre devise et le bot opère partout.',
    'footer.desc': 'Plateforme tout-en-un pour la gestion de comptes streaming et l\'automatisation WhatsApp avec IA.',
    'footer.product': 'Produit',
    'footer.account': 'Compte',
    'footer.register': 'S\'inscrire',
    'footer.legal': 'Légal',
    'footer.privacy': 'Confidentialité',
    'footer.terms': 'Conditions',
    'footer.rights': 'Tous droits réservés.',
  }
};

function landingT(key, fallback) {
  const dict = landingTranslations[landingLang] || landingTranslations['es'];
  return dict[key] || fallback || key;
}

function applyLandingTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = landingT(key);
    if (text && text !== key) {
      // Preserve child icons
      const icon = el.querySelector('i');
      if (icon) {
        el.textContent = '';
        el.appendChild(icon);
        el.append(' ' + text);
      } else {
        el.textContent = text;
      }
    }
  });

  // Update lang label
  const label = document.getElementById('langLabel');
  if (label) label.textContent = landingLang.toUpperCase();

  // Update active option
  document.querySelectorAll('.lang-opt').forEach(el => {
    el.classList.toggle('active', el.dataset.lang === landingLang);
  });

  // Re-apply current currency to update CTA text
  setCurrency(currentCurrency);
}

function setLandingLang(lang) {
  if (!LANDING_LANGS.includes(lang)) return;
  landingLang = lang;
  localStorage.setItem('streamly_lang', lang);
  applyLandingTranslations();
  const dd = document.getElementById('langDropdown');
  if (dd) dd.classList.remove('show');
}

function toggleLandingLangDropdown() {
  const dd = document.getElementById('langDropdown');
  if (dd) dd.classList.toggle('show');
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const dd = document.getElementById('langDropdown');
  const btn = document.getElementById('langBtn');
  if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target)) {
    dd.classList.remove('show');
  }
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// Navbar background on scroll
window.addEventListener('scroll', () => {
  const nav = document.querySelector('.nav');
  if (window.scrollY > 50) {
    nav.style.background = 'rgba(10, 10, 15, 0.95)';
  } else {
    nav.style.background = 'rgba(10, 10, 15, 0.8)';
  }
});

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  applyLandingTranslations();
  setCurrency('MXN');
});
