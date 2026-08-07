import { redirect } from 'next/navigation';

export default function AppIndex() {
  redirect('/app/projects');
}
