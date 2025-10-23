import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';

interface Template {
  trigger: string;
  reply: string;
}

interface Conversation {
  phone: string;
  lastMessage: string;
  lastMessageTime: string;
  messageCount: number;
}

interface Message {
  role: string;
  content: string;
}

interface ConversationDetail {
  phone: string;
  messageCount: number;
  history: Message[];
}

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [qrImage, setQrImage] = useState<string>('');
  const [connected, setConnected] = useState<boolean>(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [trigger, setTrigger] = useState<string>('');
  const [reply, setReply] = useState<string>('');
  const [statusText, setStatusText] = useState<string>('Bağlantı bekleniyor...');
  const [connectionStatus, setConnectionStatus] = useState<string>('connecting');
  const [socketId, setSocketId] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [retryCount, setRetryCount] = useState<number>(0);
  const maxRetries = 3;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeTab, setActiveTab] = useState<string>('templates');
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loadingConversations, setLoadingConversations] = useState<boolean>(false);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    initializeSocket();
    checkWhatsAppStatus();
  }, []);

  const initializeSocket = () => {
    try {
      console.log("🔄 Socket bağlantısı başlatılıyor...");
      const newSocket: any = io("http://localhost:3000", {
        transports: ["websocket", "polling"],
        timeout: 15000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        forceNew: true
      });

      newSocket.on("connect", () => {
        console.log("✅ Socket bağlandı:", newSocket.id);
        setSocketId(newSocket.id);
        setConnectionStatus("connected");
        setStatusText("Sunucuya bağlandı");
        setRetryCount(0);
        setDebugInfo(`Bağlantı ID: ${newSocket.id}`);
        newSocket.emit("get_status");
      });

      newSocket.on("disconnect", (reason: any) => {
        console.log("❌ Socket bağlantısı kesildi:", reason);
        setConnectionStatus("disconnected");
        setConnected(false);
        setStatusText(`Bağlantı kesildi: ${reason}`);
        setDebugInfo(`Son bağlantı hatası: ${reason}`);
      });

      newSocket.on("connect_error", (error: any) => {
        console.error("🔌 Bağlantı hatası:", error);
        setConnectionStatus("error");
        setRetryCount(prev => prev + 1);
        setStatusText(`Sunucuya bağlanılamıyor (${retryCount + 1}/${maxRetries})`);
        setDebugInfo(`Hata: ${error.message}`);
        
        if (retryCount + 1 >= maxRetries) {
          setStatusText("Sunucuya bağlanılamıyor. Lütfen sunucuyu kontrol edin.");
        }
      });

      newSocket.on("qr", (data: any) => {
        console.log("📱 QR kod alındı:", data ? "Evet" : "Hayır");
        setQrImage(data);
        setConnected(false);
        setConnectionStatus("qr_received");
        setStatusText("QR kodu telefonla okutun");
        setDebugInfo(`QR kod alındı`);
      });

      newSocket.on("authenticated", () => {
        console.log("🔐 Authenticated");
        setConnectionStatus("authenticated");
        setStatusText("QR kod okundu, bağlantı kuruluyor...");
        setDebugInfo("Kimlik doğrulama başarılı");
      });

      newSocket.on("ready", () => {
        console.log("✅ WhatsApp bağlandı");
        setQrImage("");
        setConnected(true);
        setConnectionStatus("ready");
        setStatusText("✅ WhatsApp bağlı");
        setDebugInfo("WhatsApp oturumu aktif");
        loadTemplates();
        loadConversations();
      });

      newSocket.on("loading_screen", (data: any) => {
        console.log("🔄 Loading screen:", data);
        setStatusText("WhatsApp yükleniyor... " + (data || ""));
        setDebugInfo(`Loading: ${data}`);
      });

      newSocket.on("whatsapp_status", (data: any) => {
        console.log("📱 WhatsApp durumu:", data);
        setDebugInfo(`WhatsApp Status: ${JSON.stringify(data)}`);
        
        if (data.status === 'ready' && data.isReady) {
          setConnected(true);
          setConnectionStatus('ready');
          setStatusText('✅ WhatsApp bağlı');
          setQrImage("");
          loadTemplates();
          loadConversations();
        } else if (data.status === 'restoring_session') {
          setConnectionStatus('connecting');
          setStatusText('🔄 Mevcut session yükleniyor...');
        } else if (data.status === 'qr_required') {
          setConnectionStatus('connected');
          setStatusText('QR kod bekleniyor...');
        } else if (data.status === 'authenticated') {
          setConnectionStatus('authenticated');
          setStatusText('Doğrulama başarılı, bağlanıyor...');
        } else if (data.status === 'loading') {
          setConnectionStatus('connecting');
          setStatusText(`WhatsApp yükleniyor... ${data.progress || ''}`);
        }
      });

      newSocket.on("message", (data: any) => {
        console.log("💬 Yeni mesaj:", data);
        loadConversations();
      });

      newSocket.on("error", (error: any) => {
        console.error("🚨 Socket error:", error);
        setStatusText("Hata: " + (error.message || error));
        setDebugInfo(`Socket hatası: ${error}`);
      });

      setSocket(newSocket);
      socketRef.current = newSocket;
    } catch (error: any) {
      console.error("🚨 Socket initialization error:", error);
      setStatusText("Bağlantı başlatılamadı");
      setDebugInfo(`Init hatası: ${error.message}`);
    }
  };

  const checkWhatsAppStatus = async () => {
    try {
      console.log("🔄 WhatsApp durumu kontrol ediliyor...");
      const response = await axios.get("http://localhost:3000/api/whatsapp-status", { timeout: 5000 });
      console.log("📊 WhatsApp durumu:", response.data);
      
      if (response.data.isReady) {
        setConnected(true);
        setConnectionStatus('ready');
        setStatusText('✅ WhatsApp bağlı');
        setQrImage("");
        loadTemplates();
        loadConversations();
      } else if (response.data.hasSession && !response.data.isReady) {
        setStatusText('🔄 Session restore ediliyor...');
        setConnectionStatus('connecting');
      } else if (response.data.hasQr) {
        setConnectionStatus('connected');
        setStatusText('QR kod bekleniyor...');
      }
    } catch (error) {
      console.error("❌ Status kontrol hatası:", error);
    }
  };

  const checkServerStatus = async () => {
    try {
      setStatusText("Sunucu kontrol ediliyor...");
      const response = await axios.get("http://localhost:3000/api/status", { timeout: 5000 });
      console.log("✅ Sunucu durumu:", response.data);
      setDebugInfo(`Sunucu: ${JSON.stringify(response.data)}`);
      setStatusText("Sunucu aktif");
    } catch (error: any) {
      console.error("❌ Sunucu kontrol hatası:", error);
      setStatusText("Sunucuya erişilemiyor");
      setDebugInfo(`Sunucu hatası: ${error.message}`);
    }
  };

  const requestQRCode = async () => {
    try {
      setStatusText("QR kod isteniyor...");
      const response = await axios.post("http://localhost:3000/api/request-qr");
      console.log("✅ QR isteği sonucu:", response.data);
      setDebugInfo(`QR isteği: ${JSON.stringify(response.data)}`);
      setStatusText("QR kod isteği gönderildi");
    } catch (error: any) {
      console.error("❌ QR isteği hatası:", error);
      setStatusText("QR kod istenemedi");
      setDebugInfo(`QR hatası: ${error.message}`);
    }
  };

  const loadTemplates = async () => {
    try {
      console.log("📋 Şablonlar yükleniyor...");
      const res = await axios.get("http://localhost:3000/api/templates");
      setTemplates(res.data);
      console.log("✅ Şablonlar yüklendi:", res.data.length);
    } catch (error) {
      console.error("❌ Şablon yükleme hatası:", error);
    }
  };

  const addTemplate = async () => {
    if (trigger.trim() && reply.trim()) {
      try {
        await axios.post("http://localhost:3000/api/templates", {
          trigger: trigger.trim(),
          reply: reply.trim(),
        });
        setTrigger("");
        setReply("");
        await loadTemplates();
      } catch (error: any) {
        console.error("❌ Şablon ekleme hatası:", error);
        alert("Şablon eklenirken hata oluştu: " + error.message);
      }
    } else {
      alert("Lütfen tetikleyici ve cevap alanlarını doldurun.");
    }
  };

  const deleteTemplate = async (index: number) => {
    if (confirm("Bu şablonu silmek istediğinizden emin misiniz?")) {
      try {
        await axios.delete(`http://localhost:3000/api/templates/${index}`);
        await loadTemplates();
      } catch (error: any) {
        console.error("❌ Şablon silme hatası:", error);
        alert("Şablon silinirken hata oluştu: " + error.message);
      }
    }
  };

  const loadConversations = async () => {
    if (!connected) return;
    
    try {
      setLoadingConversations(true);
      console.log("💬 Konuşmalar yükleniyor...");
      const response = await axios.get("http://localhost:3000/api/conversations");
      const convs = Object.values(response.data).sort((a: any, b: any) => 
        new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
      ) as Conversation[];
      setConversations(convs);
      console.log("✅ Konuşmalar yüklendi:", convs.length);
    } catch (error) {
      console.error("❌ Konuşma yükleme hatası:", error);
    } finally {
      setLoadingConversations(false);
    }
  };

  const loadConversationDetail = async (phone: string) => {
    try {
      console.log("📞 Konuşma detayı yükleniyor:", phone);
      const response = await axios.get(`http://localhost:3000/api/conversations/${phone}`);
      const detail: ConversationDetail = response.data;
      setSelectedConversation(detail);
      setConversationHistory(detail.history || []);
      console.log("✅ Konuşma detayı yüklendi:", (detail.history || []).length + " mesaj");
    } catch (error: any) {
      console.error("❌ Konuşma detay yükleme hatası:", error);
      alert("Konuşma detayı yüklenirken hata oluştu: " + error.message);
    }
  };

  const deleteConversation = async (phone: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (confirm("Bu konuşma geçmişini silmek istediğinizden emin misiniz?")) {
      try {
        await axios.delete(`http://localhost:3000/api/conversations/${phone}`);
        if (selectedConversation && selectedConversation.phone === phone) {
          setSelectedConversation(null);
          setConversationHistory([]);
        }
        await loadConversations();
      } catch (error: any) {
        console.error("❌ Konuşma silme hatası:", error);
        alert("Konuşma silinirken hata oluştu: " + error.message);
      }
    }
  };

  const clearAllConversations = async () => {
    if (confirm("Tüm konuşma geçmişini silmek istediğinizden emin misiniz?")) {
      try {
        await axios.delete("http://localhost:3000/api/conversations");
        setSelectedConversation(null);
        setConversationHistory([]);
        await loadConversations();
      } catch (error: any) {
        console.error("❌ Tüm konuşmaları silme hatası:", error);
        alert("Konuşmalar silinirken hata oluştu: " + error.message);
      }
    }
  };

  const formatPhoneNumber = (phone: string) => {
    return phone.replace(/@c\.us$/, "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3");
  };

  const formatTime = (timestamp: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString('tr-TR');
  };

  const filteredConversations = conversations.filter(conv => 
    conv.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.lastMessage.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const logout = async () => {
    if (confirm("WhatsApp bağlantısını kesmek istediğinizden emin misiniz?")) {
      try {
        await axios.post("http://localhost:3000/api/logout");
        setConnected(false);
        setConnectionStatus("connecting");
        setStatusText("Çıkış yapılıyor...");
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } catch (error: any) {
        console.error("❌ Çıkış hatası:", error);
        alert("Çıkış yapılırken hata oluştu: " + error.message);
      }
    }
  };

  const restartWhatsApp = async () => {
    if (confirm("WhatsApp bağlantısını yeniden başlatmak istediğinizden emin misiniz?")) {
      try {
        await axios.post("http://localhost:3000/api/restart");
        setConnected(false);
        setConnectionStatus("connecting");
        setStatusText("Yeniden başlatılıyor...");
        setDebugInfo("Yeniden başlatma isteği gönderildi");
      } catch (error: any) {
        console.error("❌ Yeniden başlatma hatası:", error);
        alert("Yeniden başlatma sırasında hata oluştu: " + error.message);
      }
    }
  };

  const reconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current.connect();
    } else {
      initializeSocket();
    }
  };

  const forceQRRequest = () => {
    if (socketRef.current) {
      socketRef.current.emit("get_qr");
    }
    requestQRCode();
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connecting': return 'text-yellow-400';
      case 'connected': return 'text-blue-400';
      case 'qr_received': return 'text-purple-400';
      case 'authenticated': return 'text-orange-400';
      case 'ready': return 'text-green-400';
      default: return 'text-red-400';
    }
  };

  const getStatusDot = () => {
    switch (connectionStatus) {
      case 'connecting': return 'bg-yellow-400';
      case 'connected': return 'bg-blue-400';
      case 'qr_received': return 'bg-purple-400';
      case 'authenticated': return 'bg-orange-400';
      case 'ready': return 'bg-green-400';
      default: return 'bg-red-400';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-gray-100 w-full overflow-x-hidden">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-green-500/5 rounded-full blur-3xl"></div>
      </div>

      <header className="relative bg-gray-800/30 backdrop-blur-xl border-b border-white/10 shadow-2xl">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  WhatsApp Asistanı
                </h1>
                <div className="flex items-center space-x-2 mt-1">
                  <div className={`w-2 h-2 rounded-full ${getStatusDot()} ${connectionStatus !== 'ready' ? 'animate-pulse' : ''}`}></div>
                  <p className={`text-sm font-medium ${getStatusColor()}`}>{statusText}</p>
                </div>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 justify-center">
              {socketId && (
                <div className="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full text-xs text-gray-300 border border-white/10">
                  ID: {socketId.substring(0, 8)}...
                </div>
              )}
              
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={checkServerStatus}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white text-sm rounded-xl transition-all duration-300 border border-white/10 hover:border-white/20 flex items-center space-x-1 shadow-lg hover:shadow-xl"
                  title="Sunucu Durumunu Kontrol Et"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                  </svg>
                  <span className="hidden xs:inline">Sunucu</span>
                </button>
                
                {(connectionStatus === 'connected' || connectionStatus === 'ready') && (
                  <button 
                    onClick={forceQRRequest}
                    className="px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 backdrop-blur-sm text-white text-sm rounded-xl transition-all duration-300 border border-purple-500/30 hover:border-purple-500/50 flex items-center space-x-1 shadow-lg hover:shadow-xl"
                    title="QR Kod İste"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
                    </svg>
                    <span className="hidden xs:inline">QR İste</span>
                  </button>
                )}

                {connected && (
                  <button 
                    onClick={restartWhatsApp}
                    className="px-3 py-2 bg-orange-500/20 hover:bg-orange-500/30 backdrop-blur-sm text-white text-sm rounded-xl transition-all duration-300 border border-orange-500/30 hover:border-orange-500/50 flex items-center space-x-1 shadow-lg hover:shadow-xl"
                    title="Yeniden Başlat"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                    <span className="hidden xs:inline">Yeniden Başlat</span>
                  </button>
                )}
                
                <button 
                  onClick={reconnect}
                  className="px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 backdrop-blur-sm text-white text-sm rounded-xl transition-all duration-300 border border-blue-500/30 hover:border-blue-500/50 flex items-center space-x-1 shadow-lg hover:shadow-xl"
                  title="Yeniden Bağlan"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  <span className="hidden xs:inline">Yenile</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative container mx-auto px-3 sm:px-4 py-6 sm:py-8">
        {debugInfo && (
          <div className="max-w-6xl mx-auto mb-6">
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm font-mono truncate">Debug: {debugInfo}</span>
                <button 
                  onClick={() => setDebugInfo("")}
                  className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0 ml-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {(connectionStatus === 'error' || connectionStatus === 'disconnected') && (
          <div className="max-w-2xl mx-auto mb-6">
            <div className="bg-red-500/10 backdrop-blur-xl border border-red-500/20 rounded-2xl p-4 shadow-2xl">
              <div className="flex items-center space-x-3">
                <svg className="w-6 h-6 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <div className="flex-1">
                  <h3 className="text-red-300 font-semibold">Bağlantı Sorunu</h3>
                  <p className="text-red-400 text-sm mt-1">
                    Sunucuya bağlanılamıyor. Lütfen sunucunun çalıştığından emin olun.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {qrImage && !connected && (
          <div className="max-w-md mx-auto bg-white/5 backdrop-blur-xl rounded-3xl shadow-2xl p-6 border border-white/10">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">QR Kod ile Bağlan</h2>
              <p className="text-gray-400">WhatsApp uygulamasından QR kodu okutun</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm p-6 rounded-2xl border border-white/10 shadow-lg">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrImage)}&size=300x300`}
                alt="QR Code"
                className="w-full max-w-xs mx-auto rounded-xl shadow-lg"
              />
            </div>
            <div className="mt-6 p-4 bg-blue-500/10 backdrop-blur-sm border border-blue-500/20 rounded-2xl">
              <p className="text-blue-300 text-sm text-center font-medium">
                📱 WhatsApp &gt; Ayarlar &gt; Bağlı Cihazlar &gt; Cihaz Bağla
              </p>
            </div>
          </div>
        )}

        {(connectionStatus === 'connected' || connectionStatus === 'connecting') && !qrImage && !connected && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 text-center shadow-2xl">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Session Yükleniyor</h3>
              <p className="text-gray-400 mb-8 text-lg">
                {statusText}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button 
                  onClick={forceQRRequest}
                  className="px-6 py-4 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-2xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center justify-center space-x-3 font-semibold"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
                  </svg>
                  <span>Yeni QR Kod İste</span>
                </button>
                <button 
                  onClick={checkServerStatus}
                  className="px-6 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white rounded-2xl transition-all duration-300 border border-white/10 hover:border-white/20 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center justify-center space-x-3 font-semibold"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                  </svg>
                  <span>Durumu Kontrol Et</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {connectionStatus === 'connecting' && !qrImage && !connected && (
          <div className="max-w-md mx-auto text-center">
            <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl">
              <div className="w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
              <h3 className="text-2xl font-bold text-white mb-3">Bağlantı Kuruluyor</h3>
              <p className="text-gray-400 text-lg">{statusText}</p>
            </div>
          </div>
        )}

        {connected && (
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm font-medium">Bağlantı</p>
                    <p className="text-3xl font-bold bg-gradient-to-r from-green-400 to-green-600 bg-clip-text text-transparent">Aktif</p>
                  </div>
                  <div className="w-14 h-14 bg-gradient-to-br from-green-400 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/>
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm font-medium">Toplam Şablon</p>
                    <p className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">{templates.length}</p>
                  </div>
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm font-medium">Toplam Konuşma</p>
                    <p className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">{conversations.length}</p>
                  </div>
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-400 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm font-medium">Toplam Mesaj</p>
                    <p className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
                      {conversations.reduce((total, conv) => total + conv.messageCount, 0)}
                    </p>
                  </div>
                  <div className="w-14 h-14 bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 overflow-hidden">
              <div className="border-b border-white/10">
                <nav className="flex space-x-8 px-6">
                  <button
                    className={`py-4 px-2 border-b-2 font-medium text-sm transition-all duration-300 ${
                      activeTab === 'templates'
                        ? 'border-green-500 text-green-400'
                        : 'border-transparent text-gray-400 hover:text-gray-300'
                    }`}
                    onClick={() => setActiveTab('templates')}
                  >
                    <div className="flex items-center space-x-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                      </svg>
                      <span>Hazır Cevaplar</span>
                      {templates.length > 0 && (
                        <span className="bg-green-500/20 text-green-300 px-2 py-1 rounded-full text-xs">
                          {templates.length}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    className={`py-4 px-2 border-b-2 font-medium text-sm transition-all duration-300 ${
                      activeTab === 'conversations'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-gray-400 hover:text-gray-300'
                    }`}
                    onClick={() => {
                      setActiveTab('conversations');
                      loadConversations();
                    }}
                  >
                    <div className="flex items-center space-x-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                      </svg>
                      <span>Geçmiş Konuşmalar</span>
                      {conversations.length > 0 && (
                        <span className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded-full text-xs">
                          {conversations.length}
                        </span>
                      )}
                    </div>
                  </button>
                </nav>
              </div>

              {activeTab === 'templates' && (
                <div>
                  <div className="bg-gradient-to-r from-white/10 to-white/5 px-6 py-6 border-b border-white/10">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold text-white flex items-center">
                          <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center mr-3 shadow-lg">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                            </svg>
                          </div>
                          Hazır Cevaplar
                        </h2>
                        <p className="text-gray-400 text-sm mt-2">Belirlediğiniz tetikleyici kelimelerle otomatik cevap verin</p>
                      </div>
                      <div className="text-sm text-gray-400 bg-white/5 rounded-xl px-3 py-2 border border-white/10">
                        {templates.length} şablon
                      </div>
                    </div>
                  </div>

                  <div className="p-6 border-b border-white/10 bg-white/5">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                      <div>
                        <label className="block text-sm font-semibold text-gray-300 mb-3">
                          <span className="flex items-center space-x-2">
                            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                            </svg>
                            <span>Tetikleyici Kelime</span>
                          </span>
                        </label>
                        <input
                          type="text"
                          placeholder="örn: merhaba, selam, nasılsın"
                          value={trigger}
                          onChange={(e) => setTrigger(e.target.value)}
                          className="w-full px-4 py-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all duration-300 text-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-300 mb-3">
                          <span className="flex items-center space-x-2">
                            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                            <span>Otomatik Cevap</span>
                          </span>
                        </label>
                        <input
                          type="text"
                          placeholder="örn: Hoş geldiniz! Size nasıl yardımcı olabilirim?"
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          className="w-full px-4 py-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-300 text-lg"
                        />
                      </div>
                    </div>
                    <button
                      onClick={addTemplate}
                      className="w-full lg:w-auto px-8 py-4 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold rounded-2xl transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900 shadow-lg hover:shadow-xl flex items-center justify-center space-x-3 text-lg"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                      </svg>
                      <span>Yeni Şablon Ekle</span>
                    </button>
                  </div>

                  <div className="p-6">
                    {templates.length > 0 ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {templates.map((t, i) => (
                          <div key={i} className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all duration-300 hover:scale-105 group">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-start space-x-4">
                                  <div className="w-3 h-3 bg-gradient-to-r from-green-400 to-green-600 rounded-full mt-2 flex-shrink-0"></div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
                                      <span className="px-3 py-2 bg-blue-500/20 text-blue-300 rounded-xl text-sm font-semibold border border-blue-500/30">
                                        {t.trigger}
                                      </span>
                                      <svg className="w-5 h-5 text-gray-500 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
                                      </svg>
                                      <span className="text-gray-300 text-lg font-medium truncate">{t.reply}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => deleteTemplate(i)}
                                className="opacity-0 group-hover:opacity-100 ml-4 p-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-all duration-300 transform hover:scale-110 flex-shrink-0"
                                title="Şablonu Sil"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <div className="w-24 h-24 bg-gradient-to-br from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                          <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                          </svg>
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-3">Henüz şablon bulunmuyor</h3>
                        <p className="text-gray-400 text-lg max-w-md mx-auto">
                          İlk şablonunuzu oluşturmak için yukarıdaki formu doldurun ve otomatik cevaplamaya başlayın.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'conversations' && (
                <div>
                  <div className="bg-gradient-to-r from-white/10 to-white/5 px-6 py-6 border-b border-white/10">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold text-white flex items-center">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center mr-3 shadow-lg">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                            </svg>
                          </div>
                          Geçmiş Konuşmalar
                        </h2>
                        <p className="text-gray-400 text-sm mt-2">Tüm WhatsApp konuşma geçmişiniz burada kayıt altında</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Konuşma ara..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-300 w-full sm:w-64"
                          />
                          <svg className="w-5 h-5 text-gray-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                          </svg>
                        </div>
                        {conversations.length > 0 && (
                          <button
                            onClick={clearAllConversations}
                            className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-xl transition-all duration-300 border border-red-500/30 hover:border-red-500/50 flex items-center space-x-2 whitespace-nowrap"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                            <span>Tümünü Temizle</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-6">
                    {loadingConversations ? (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                        <p className="text-gray-400">Konuşmalar yükleniyor...</p>
                      </div>
                    ) : filteredConversations.length > 0 ? (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold text-white mb-4">Konuşmalar ({filteredConversations.length})</h3>
                          {filteredConversations.map((conversation) => (
                            <div
                              key={conversation.phone}
                              className={`bg-white/5 backdrop-blur-sm rounded-2xl p-4 border transition-all duration-300 cursor-pointer hover:scale-105 group ${
                                selectedConversation?.phone === conversation.phone
                                  ? 'border-blue-500 bg-blue-500/10'
                                  : 'border-white/10 hover:border-white/20'
                              }`}
                              onClick={() => loadConversationDetail(conversation.phone)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center space-x-3 mb-2">
                                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                                      </svg>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-white font-semibold truncate">
                                        {formatPhoneNumber(conversation.phone)}
                                      </p>
                                      <p className="text-gray-400 text-sm truncate">
                                        {conversation.lastMessage}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between text-xs text-gray-500">
                                    <span>{conversation.messageCount} mesaj</span>
                                    <span>{formatTime(conversation.lastMessageTime)}</span>
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => deleteConversation(conversation.phone, e)}
                                  className="opacity-0 group-hover:opacity-100 ml-3 p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all duration-300 transform hover:scale-110 flex-shrink-0"
                                  title="Konuşmayı Sil"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                          {selectedConversation ? (
                            <div className="mb-6">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-white">
                                  Konuşma Detayı
                                </h3>
                                <div className="text-sm text-gray-400 bg-white/5 rounded-lg px-3 py-1">
                                  {conversationHistory.length} mesaj
                                </div>
                              </div>
                              <div className="flex items-center space-x-3 p-3 bg-white/5 rounded-xl">
                                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                                  </svg>
                                </div>
                                <div>
                                  <p className="text-white font-semibold">{formatPhoneNumber(selectedConversation.phone)}</p>
                                  <p className="text-gray-400 text-sm">Toplam {selectedConversation.messageCount} mesaj</p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-center py-12">
                              <div className="w-24 h-24 bg-gradient-to-br from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                                </svg>
                              </div>
                              <h3 className="text-2xl font-bold text-white mb-3">Konuşma Seçin</h3>
                              <p className="text-gray-400 text-lg">
                                Detaylarını görmek için soldan bir konuşma seçin
                              </p>
                            </div>
                          )}

                          {selectedConversation && (
                            <div className="space-y-4 max-h-96 overflow-y-auto">
                              {conversationHistory.map((message, index) => (
                                <div key={index} className={`p-4 rounded-2xl transition-all duration-300 ${
                                  message.role === 'user' 
                                    ? 'bg-blue-500/10 border border-blue-500/20 ml-8' 
                                    : 'bg-green-500/10 border border-green-500/20 mr-8'
                                }`}>
                                  <div className="flex items-start space-x-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                      message.role === 'user' 
                                        ? 'bg-blue-500/20' 
                                        : 'bg-green-500/20'
                                    }`}>
                                      <svg className={`w-4 h-4 ${
                                        message.role === 'user' ? 'text-blue-400' : 'text-green-400'
                                      }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={
                                          message.role === 'user' 
                                            ? 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
                                            : 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
                                        }/>
                                      </svg>
                                    </div>
                                    <div className="flex-1">
                                      <p className="text-white text-sm mb-1">
                                        {message.role === 'user' ? 'Kullanıcı' : 'Asistan'}
                                      </p>
                                      <p className="text-gray-300">{message.content}</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <div className="w-24 h-24 bg-gradient-to-br from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                          <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                          </svg>
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-3">Henüz konuşma yok</h3>
                        <p className="text-gray-400 text-lg max-w-md mx-auto">
                          WhatsApp üzerinden gelen mesajlar burada görünecek
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {connected && (
          <div className="text-center">
            <button
              onClick={logout}
              className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold rounded-2xl transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900 space-x-3 shadow-lg hover:shadow-xl text-lg"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
              <span>WhatsApp Bağlantısını Kes</span>
            </button>
          </div>
        )}
      </main>

      <footer className="relative border-t border-white/10 mt-12 py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-gray-500 text-sm">
            © 2024 WhatsApp Asistan
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;