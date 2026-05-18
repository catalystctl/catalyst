import { getFileTypeInfo } from './fileTypes';

export function FileTypeIcon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
 const info = getFileTypeInfo(name);
 const Icon = info.icon;
 return <Icon className={`${className} ${info.color}`} />;
}
