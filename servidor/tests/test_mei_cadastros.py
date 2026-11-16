import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('mei_cadastros', Path(__file__).parents[1] / 'mei_cadastros.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTest(unittest.TestCase):
    def config(self, **portal):
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = Path(pasta) / 'config.json'
            arquivo.write_text(json.dumps({'portal': portal}))
            return worker.configuracao(arquivo)

    def test_escopo_e_endpoint_sem_chave_transmitida(self):
        url, token = self.config(chave_service_role='ficticia')
        self.assertEqual(url, 'https://xml.lotivisse.com.br/api/robo/mei-cadastros')
        self.assertEqual(token, hmac.new(b'ficticia', b'lotivisse:mei-cadastros:v1', hashlib.sha256).hexdigest())
        class Resposta:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): return b'{"processado":true}'
        def abrir(req, timeout):
            self.assertEqual(req.get_header('X-mei-worker'), token)
            self.assertIsNone(req.get_header('Authorization'))
            self.assertNotIn(b'ficticia', req.data)
            self.assertEqual(req.get_method(), 'POST')
            self.assertEqual(timeout, 25)
            return Resposta()
        self.assertTrue(worker.consultar(url, token, abrir)['processado'])

    def test_rejeita_origem_insegura_e_redirecionamento(self):
        for site in ['http://exemplo.test', 'https://user:senha@exemplo.test', 'https://exemplo.test/api', 'https://exemplo.test?q=1']:
            with self.assertRaises(ValueError): self.config(site=site, chave_service_role='ficticia')
        self.assertIsNone(worker.SemRedirecionamento().redirect_request(None,None,302,'',{},'https://outro.test'))

    def test_sem_chave_nao_inicia(self):
        with self.assertRaises(ValueError): self.config()


if __name__ == '__main__': unittest.main()
