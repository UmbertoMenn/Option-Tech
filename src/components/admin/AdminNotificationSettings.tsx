import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Mail, MessageCircle, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

interface UserProfile {
  user_id: string;
  email: string;
  full_name: string | null;
  notify_email: boolean;
  notify_telegram: boolean;
  telegram_chat_id: string | null;
}

export function AdminNotificationSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [adminNotifyEmail, setAdminNotifyEmail] = useState(true);
  const [adminNotifyTelegram, setAdminNotifyTelegram] = useState(true);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (user) {
      loadSettings();
      loadUserProfiles();
    }
  }, [user]);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('admin_notify_email, admin_notify_telegram')
        .eq('user_id', user!.id)
        .single();

      if (error) throw error;
      if (data) {
        setAdminNotifyEmail(data.admin_notify_email ?? true);
        setAdminNotifyTelegram(data.admin_notify_telegram ?? true);
      }
    } catch (error) {
      console.error('Error loading admin notification settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadUserProfiles() {
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, notify_email, notify_telegram, telegram_chat_id')
        .neq('user_id', user!.id)
        .order('email');

      if (error) throw error;
      setUserProfiles(
        (data || []).map((p) => ({
          user_id: p.user_id,
          email: p.email,
          full_name: p.full_name,
          notify_email: p.notify_email ?? true,
          notify_telegram: p.notify_telegram ?? false,
          telegram_chat_id: p.telegram_chat_id,
        }))
      );
    } catch (error) {
      console.error('Error loading user profiles:', error);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function updateSetting(field: 'admin_notify_email' | 'admin_notify_telegram', value: boolean) {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ [field]: value })
        .eq('user_id', user!.id);

      if (error) throw error;

      if (field === 'admin_notify_email') setAdminNotifyEmail(value);
      else setAdminNotifyTelegram(value);

      // Propagate to all users
      const userField = field === 'admin_notify_email' ? 'notify_email' : 'notify_telegram';
      let query = supabase.from('profiles').update({ [userField]: value }).neq('user_id', user!.id);
      if (userField === 'notify_telegram') {
        query = query.not('telegram_chat_id', 'is', null);
      }
      const { error: batchError } = await query;
      if (batchError) throw batchError;

      setUserProfiles((prev) =>
        prev.map((p) => ({
          ...p,
          [userField]: userField === 'notify_telegram' && !p.telegram_chat_id ? p.notify_telegram : value,
        }))
      );

      toast.success('Notifiche aggiornate per tutti gli utenti');
    } catch (error) {
      console.error('Error updating setting:', error);
      toast.error('Errore aggiornamento impostazione');
    }
  }

  async function updateUserSetting(
    targetUserId: string,
    field: 'notify_email' | 'notify_telegram',
    value: boolean
  ) {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ [field]: value })
        .eq('user_id', targetUserId);

      if (error) throw error;

      setUserProfiles((prev) =>
        prev.map((p) => (p.user_id === targetUserId ? { ...p, [field]: value } : p))
      );

      toast.success('Notifica utente aggiornata');
    } catch (error) {
      console.error('Error updating user setting:', error);
      toast.error('Errore aggiornamento notifica utente');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Admin own notification settings */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Notifiche Admin</CardTitle>
          <CardDescription>
            Controlla la ricezione delle copie delle notifiche generate dai portafogli degli utenti.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-muted-foreground" />
              <Label htmlFor="admin-email" className="cursor-pointer">
                Email utenti
                <p className="text-xs text-muted-foreground font-normal mt-0.5">
                  Ricevi via email le copie degli avvisi degli utenti
                </p>
              </Label>
            </div>
            <Switch
              id="admin-email"
              checked={adminNotifyEmail}
              onCheckedChange={(val) => updateSetting('admin_notify_email', val)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageCircle className="w-5 h-5 text-muted-foreground" />
              <Label htmlFor="admin-telegram" className="cursor-pointer">
                Telegram utenti
                <p className="text-xs text-muted-foreground font-normal mt-0.5">
                  Ricevi via Telegram le copie degli avvisi degli utenti
                </p>
              </Label>
            </div>
            <Switch
              id="admin-telegram"
              checked={adminNotifyTelegram}
              onCheckedChange={(val) => updateSetting('admin_notify_telegram', val)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-user notification settings */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Notifiche Utenti</CardTitle>
          </div>
          <CardDescription>
            Attiva o disattiva le notifiche per singolo utente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : userProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nessun utente trovato</p>
          ) : (
            <div className="space-y-4">
              {userProfiles.map((profile) => (
                <div
                  key={profile.user_id}
                  className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {profile.full_name || profile.email}
                    </p>
                    {profile.full_name && (
                      <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                    )}
                    {profile.telegram_chat_id && (
                      <Badge variant="outline" className="mt-1 text-xs">
                        <MessageCircle className="w-3 h-3 mr-1" />
                        Telegram ✓
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <Switch
                        checked={profile.notify_email}
                        onCheckedChange={(val) =>
                          updateUserSetting(profile.user_id, 'notify_email', val)
                        }
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MessageCircle className="w-4 h-4 text-muted-foreground" />
                      <Switch
                        checked={profile.notify_telegram}
                        disabled={!profile.telegram_chat_id}
                        onCheckedChange={(val) =>
                          updateUserSetting(profile.user_id, 'notify_telegram', val)
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
