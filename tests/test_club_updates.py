"""Integration tests against a disposable PostgreSQL database (HUB_DATABASE_URL).
Run: HUB_ADMIN_PASSWORD=testing123 HUB_DIST=frontend/dist .venv/bin/python -m unittest discover -s tests -v
"""
import base64
import os
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

os.environ.setdefault('HUB_ADMIN_PASSWORD', 'testing123')
os.environ.setdefault('HUB_DIST', 'frontend/dist')
import app as portal
import push_service
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException
from py_vapid import Vapid


class ClubUpdates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker=patch('push_service.worker',lambda *args:None)
        cls.worker.start()
        cls.client=TestClient(portal.app,headers={'origin':portal.ORIGIN})
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None,None,None)
        cls.worker.stop()
        portal.app.dependency_overrides.clear()

    def setUp(self):
        with portal.connect() as conn:
            conn.execute("TRUNCATE members RESTART IDENTITY CASCADE")
            self.ids={}
            for name,role in [('root','superadmin'),('coach','coach'),('other','coach'),('member','member'),('outsider','member')]:
                self.ids[name]=conn.execute('INSERT INTO members(name,email,role,password_hash) VALUES (%s,%s,%s,%s) RETURNING id',
                    (name,None if role=='superadmin' else name+'@test.sk',role,'set')).fetchone()['id']
            conn.execute("INSERT INTO chat_groups(name,system_key) VALUES ('Celý tím','team'),('Tréneri','coaches')")
        self.as_user('coach')

    def as_user(self,name):
        def current():
            with portal.connect() as conn:
                return conn.execute('SELECT * FROM members WHERE id=%s',(self.ids[name],)).fetchone()
        portal.app.dependency_overrides[portal.identity]=current

    def sql(self,query,args=()):
        with portal.connect() as conn:
            cursor=conn.execute(query,args or None,prepare=False)
            return cursor.fetchall() if cursor.description else []

    def post(self,path,data):
        response=self.client.post(portal.PREFIX+'/api/'+path,json=data)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def get(self,path):
        response=self.client.get(portal.PREFIX+'/api/'+path)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def event(self,**extra):
        data={'title':'Stretnutie','starts_at':(datetime.now(timezone.utc)+timedelta(days=10)).isoformat(),'location':'Hala','kind':'meeting',**extra}
        self.post('trainings',data)
        return self.sql('SELECT max(id) AS id FROM trainings')[0]['id'],data

    def subscription(self):
        key=ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
        b64=lambda b:base64.urlsafe_b64encode(b).decode().rstrip('=')
        return {'endpoint':'https://fcm.googleapis.com/fcm/send/test','keys':{'p256dh':b64(key),'auth':b64(os.urandom(16))}}

    def test_event_delete_is_owned_silent_and_cascades(self):
        event,data=self.event()
        self.sql("INSERT INTO participation(training_id,member_id,response,attended) VALUES (%s,%s,'yes',true)",(event,self.ids['member']))
        self.post(f'trainings/{event}/cancel',{})
        notice=self.sql('SELECT * FROM announcements WHERE event_id=%s',(event,))[0]
        self.assertEqual(notice['title'],'Zrušená udalosť: Stretnutie')
        self.sql('INSERT INTO announcement_reads VALUES (%s,%s)',(notice['id'],self.ids['member']))
        self.as_user('other')
        self.assertFalse(next(t for t in self.get('trainings') if t['id']==event)['can_delete'])
        self.assertEqual(self.client.delete(f'{portal.PREFIX}/api/trainings/{event}').status_code,403)
        self.as_user('member')
        self.assertEqual(self.client.delete(f'{portal.PREFIX}/api/trainings/{event}').status_code,403)
        self.as_user('coach')
        self.assertEqual(self.client.delete(f'{portal.PREFIX}/api/trainings/{event}').status_code,200)
        for table,column in [('trainings','id'),('participation','training_id'),('announcements','event_id'),('push_notifications','event_id')]:
            self.assertFalse(self.sql(f'SELECT 1 FROM {table} WHERE {column}=%s',(event,)))
        self.assertFalse(self.sql('SELECT 1 FROM announcement_reads WHERE announcement_id=%s',(notice['id'],)))

    def test_legacy_migration_is_repeatable_and_precise(self):
        event,data=self.event()
        self.sql('UPDATE trainings SET created_by=NULL WHERE id=%s',(event,))
        stamp=portal.club_date(datetime.fromisoformat(data['starts_at']))
        for _ in range(2):
            self.sql("INSERT INTO announcements(title,body) VALUES (%s,%s)",('Zrušený tréning: Stretnutie',f'Termín {stamp} · Hala bol zrušený.'))
        for _ in range(2):
            self.sql(Path('schema.sql').read_text())
        self.assertEqual(len(self.sql('SELECT 1 FROM announcements WHERE event_id=%s',(event,))),2)
        self.as_user('other')
        self.assertEqual(self.client.delete(f'{portal.PREFIX}/api/trainings/{event}').status_code,200)
        self.assertFalse(self.sql('SELECT 1 FROM announcements'))

    def test_targeted_notices_and_attachment_access_and_edit(self):
        draft=self.post('announcement-drafts',{})['id']
        response=self.client.post(f'{portal.PREFIX}/api/announcement-drafts/{draft}/attachments',content=b'%PDF-1.4 test',headers={'x-filename':'plán.pdf'.encode().hex()})
        self.assertEqual(response.status_code,200,response.text)
        data={'title':'Súkromný oznam','body':'Text','audience':'selected','recipient_ids':[self.ids['member']],'draft_id':draft,'notify':True}
        notice=self.post('announcements',data)['id']
        attachment=self.get('announcements')[0]['attachments'][0]['id']
        self.assertFalse(self.sql('SELECT 1 FROM announcement_drafts WHERE id=%s',(draft,)))
        self.as_user('outsider')
        self.assertFalse(self.get('announcements'))
        for route in [f'announcements/{notice}/attachments/{attachment}',f'push/notifications/999999']:
            self.assertEqual(self.client.get(f'{portal.PREFIX}/api/'+route).status_code,404)
        self.assertEqual(self.client.post(f'{portal.PREFIX}/api/announcements/{notice}/read',json={}).status_code,404)
        self.as_user('member')
        self.assertEqual(self.client.get(f'{portal.PREFIX}/api/announcements/{notice}/attachments/{attachment}').content,b'%PDF-1.4 test')
        self.post(f'announcements/{notice}/read',{})
        self.as_user('coach')
        data.update(draft_id=None,title='Upravené',notify=False,keep_attachment_ids=[attachment],recipient_ids=[self.ids['outsider']])
        response=self.client.put(f'{portal.PREFIX}/api/announcements/{notice}',json=data)
        self.assertEqual(response.status_code,200,response.text)
        self.assertFalse(self.sql('SELECT 1 FROM announcement_reads WHERE announcement_id=%s',(notice,)))
        self.assertFalse(self.sql('SELECT 1 FROM push_notifications WHERE announcement_id=%s',(notice,)))
        self.as_user('member')
        self.assertFalse(self.get('announcements'))
        self.as_user('outsider')
        self.assertEqual(self.get('announcements')[0]['title'],'Upravené')
        self.as_user('coach')
        self.client.delete(f'{portal.PREFIX}/api/announcements/{notice}')
        self.assertFalse(self.sql('SELECT 1 FROM announcement_attachments'))

    def test_coaches_audience_tracks_role_and_no_superadmin_recipient(self):
        self.post('announcements',{'title':'Tréneri','body':'Text','audience':'coaches'})
        self.as_user('member')
        self.assertFalse(self.get('announcements'))
        self.sql("UPDATE members SET role='member' WHERE id=%s",(self.ids['other'],))
        self.as_user('other')
        self.assertFalse(self.get('announcements'))
        self.as_user('coach')
        self.assertNotIn(self.ids['root'],[r['id'] for r in self.get('announcement-recipients')])
        self.assertEqual(self.client.post(f'{portal.PREFIX}/api/announcements',json={'title':'x','body':'x','audience':'selected','recipient_ids':[self.ids['root']]}).status_code,422)

    def test_push_channels_delivery_and_disabled_preferences(self):
        self.as_user('member')
        config=self.get('push/config')
        key=self.sql('SELECT * FROM push_keys')[0]
        self.assertTrue(Vapid.from_string(key['private_key']).sign({'sub':'https://example.com','aud':'https://fcm.googleapis.com'}))
        with portal.connect() as conn:push_service.initialize(conn)
        self.assertEqual(config,self.get('push/config'))
        subscription=self.subscription()
        self.post('push/subscriptions',subscription)
        self.as_user('coach')
        self.post('messages',{'recipient_id':self.ids['member'],'body':'Hello'})
        group=self.sql("SELECT id FROM chat_groups WHERE system_key='team'")[0]['id']
        self.post('messages',{'group_id':group,'body':'Team message'})
        event,data=self.event()
        self.post('announcements',{'title':'Oznam','body':'Text'})
        self.assertEqual({r['channel'] for r in self.sql('SELECT DISTINCT channel FROM push_notifications WHERE member_id=%s',(self.ids['member'],))},{'messages','calendar','announcements'})
        self.as_user('member')
        preferences={'push_messages':False,'push_calendar':False,'push_announcements':True}
        self.assertEqual(self.client.put(f'{portal.PREFIX}/api/me/notification-preferences',json=preferences).status_code,200)
        message_notice=self.sql("SELECT id FROM push_notifications WHERE channel='messages' AND member_id=%s",(self.ids['member'],))[0]['id']
        self.assertEqual(self.client.get(f'{portal.PREFIX}/api/push/notifications/{message_notice}').status_code,404)
        with patch('push_service.webpush') as send:
            while push_service.deliver_one(portal.connect,portal.PUBLIC_URL):pass
            self.assertEqual(send.call_count,1)
            self.assertIn('id',send.call_args.kwargs['data'])
        self.as_user('coach')
        self.post('messages',{'recipient_id':self.ids['member'],'body':'Muted'})
        self.assertEqual(len(self.sql("SELECT id FROM push_notifications WHERE channel='messages' AND member_id=%s",(self.ids['member'],))),2)
        self.as_user('member')
        bad={**subscription,'endpoint':'https://127.0.0.1/private'}
        self.assertEqual(self.client.post(f'{portal.PREFIX}/api/push/subscriptions',json=bad).status_code,422)
        self.assertEqual(self.client.request('DELETE',f'{portal.PREFIX}/api/push/subscriptions',json={'endpoint':subscription['endpoint']}).status_code,200)
        self.assertFalse(self.sql('SELECT 1 FROM push_deliveries'))

    def test_real_encryption_retry_and_expired_subscription(self):
        self.as_user('member')
        self.post('push/subscriptions',self.subscription())
        self.as_user('coach')
        self.post('announcements',{'title':'Push','body':'Test'})
        from unittest.mock import Mock
        with patch('requests.post',return_value=Mock(status_code=201)) as transport:
            self.assertTrue(push_service.deliver_one(portal.connect,portal.PUBLIC_URL))
            self.assertTrue(transport.call_args.kwargs['data'])
            self.assertEqual(transport.call_args.kwargs['timeout'],5)
            self.assertIn('authorization',{k.lower():v for k,v in transport.call_args.kwargs['headers'].items()})
        self.post('announcements',{'title':'Retry','body':'Test'})
        with patch('push_service.webpush',side_effect=WebPushException('offline')):
            self.assertTrue(push_service.deliver_one(portal.connect,portal.PUBLIC_URL))
        pending=self.sql('SELECT attempts,done FROM push_deliveries WHERE NOT done')
        self.assertEqual(len(pending),1)
        self.assertEqual(pending[0]['attempts'],1)
        self.sql("UPDATE push_deliveries SET next_attempt=now() WHERE NOT done")
        with patch('push_service.webpush',side_effect=WebPushException('gone',response=Mock(status_code=410))):
            self.assertTrue(push_service.deliver_one(portal.connect,portal.PUBLIC_URL))
        self.assertFalse(self.sql('SELECT 1 FROM push_subscriptions'))

    def test_notification_preferences_persist_across_real_sessions(self):
        portal.app.dependency_overrides.clear()
        self.sql('UPDATE members SET password_hash=%s WHERE id=%s',
                 (portal.password_hash('member123'),self.ids['member']))
        self.client.cookies.clear()
        self.post('login',{'login':'member@test.sk','password':'member123'})
        prefs={'push_messages':False,'push_calendar':True,'push_announcements':False}
        self.assertEqual(self.client.put(f'{portal.PREFIX}/api/me/notification-preferences',json=prefs).status_code,200)
        self.post('logout',{})
        self.assertEqual(self.client.get(f'{portal.PREFIX}/api/me').status_code,401)
        self.post('login',{'login':'member@test.sk','password':'member123'})
        self.assertEqual({key:self.get('me')[key] for key in prefs},prefs)
        self.post('logout',{})

    def test_attachment_validation_limits_and_member_cannot_publish(self):
        draft=self.post('announcement-drafts',{})['id']
        endpoint=f'{portal.PREFIX}/api/announcement-drafts/{draft}/attachments'
        self.assertEqual(self.client.post(endpoint,content=b'<script>x</script>',headers={'x-filename':'x.html'.encode().hex()}).status_code,422)
        self.assertEqual(self.client.post(endpoint,content=b'%PDF-'+b'x'*(5*1024*1024),headers={'x-filename':'x.pdf'.encode().hex()}).status_code,413)
        self.as_user('other')
        self.assertEqual(self.client.post(endpoint,content=b'%PDF-test',headers={'x-filename':'x.pdf'.encode().hex()}).status_code,404)
        self.as_user('member')
        self.assertEqual(self.client.post(f'{portal.PREFIX}/api/announcements',json={'title':'x','body':'x'}).status_code,403)


if __name__=='__main__':unittest.main()
