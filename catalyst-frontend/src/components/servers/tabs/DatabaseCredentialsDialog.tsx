import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import DataField from './DataField';
import type { ServerDatabase } from '../../../types/database';

interface Props {
  credentials: ServerDatabase;
  onClose: () => void;
}

// One-time reveal for database credentials: the API returns the password
// only inside the create/rotate response, so surface it in a dialog with
// copy buttons instead of dropping it on the floor.
export default function DatabaseCredentialsDialog({ credentials, onClose }: Props) {
  const { t } = useTranslation('server-tabs');

  return (
    <AlertDialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader
          icon={<KeyRound className="h-4 w-4" />}
          iconClassName="border-warning/20 bg-warning/10 text-warning"
        >
          <AlertDialogTitle>{t('tabs.databases.credentialsTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('tabs.databases.credentialsWarning')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div>
          <DataField
            label={t('tabs.databases.credentialsHost')}
            value={`${credentials.host}:${credentials.port}`}
            copyable
          />
          <DataField label={t('tabs.databases.fields.database')} value={credentials.name} copyable />
          <DataField
            label={t('tabs.databases.fields.username')}
            value={credentials.username}
            copyable
          />
          <DataField
            label={t('tabs.databases.fields.password')}
            value={credentials.password}
            copyable
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>
            {t('tabs.databases.credentialsDone')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
