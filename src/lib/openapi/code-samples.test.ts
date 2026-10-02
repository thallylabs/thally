import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { operationFrom } from '@/components/api/test-fixtures'
import { buildCodeSamples, SAMPLE_LANGUAGES, type SampleRequest } from '@/lib/openapi/code-samples'

const post: SampleRequest = {
  method: 'POST',
  url: 'https://api.example.com/v2/scrape',
  headers: { Authorization: 'Bearer YOUR_API_KEY', 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: "https://x.dev/it's", formats: ['markdown'], onlyMainContent: true, maxAge: null, note: 'cost $5 #{x}', location: { country: 'US' } }),
}
const get: SampleRequest = {
  method: 'GET',
  url: 'https://api.example.com/v2/monitor/{monitorId}?limit=10&status=ok',
  headers: { Authorization: 'Bearer YOUR_API_KEY' },
}
const del: SampleRequest = { method: 'DELETE', url: 'https://api.example.com/v2/monitor/m1', headers: { Authorization: 'Bearer YOUR_API_KEY' } }

const bySource = (request: SampleRequest) => Object.fromEntries(buildCodeSamples(request).map((s) => [s.label, s.source]))

const has = (cmd: string, args: Array<string> = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0

// Writes `source` to a file and runs a syntax-only check; undefined when the tool is not installed.
function check(cmd: string, args: (file: string) => Array<string>, ext: string, source: string, input?: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'sample-')), `sample.${ext}`)
  writeFileSync(file, source)
  return spawnSync(cmd, args(file), { encoding: 'utf8', input })
}

describe('buildCodeSamples', () => {
  it('offers the seven live languages in order', () => {
    expect(buildCodeSamples(post).map((s) => s.label)).toEqual(['cURL', 'Python', 'JavaScript', 'PHP', 'Go', 'Java', 'Ruby'])
    expect([...SAMPLE_LANGUAGES]).toHaveLength(7)
  })

  it('shows the Try it key placeholder as <token>', () => {
    for (const source of Object.values(bySource(post))) {
      expect(source).toContain('Bearer <token>')
      expect(source).not.toContain('YOUR_API_KEY')
    }
  })

  it('keeps PHP sample inputs literal across backslashes and quotes', () => {
    const literal = String.raw`before\'; system('id'); $HOME`
    const php = bySource({
      method: 'POST',
      url: `https://example.test/${literal}`,
      headers: { 'X-Probe': literal },
      body: literal,
    }).PHP

    expect(php).toContain(String.raw`before\\\'; system(\'id\'); $HOME`)
    expect(php).not.toContain(String.raw`before\'; system('id'); $HOME`)
  })

  it('pins a POST with a JSON body', () => {
    expect(bySource(post)).toMatchInlineSnapshot(`
      {
        "Go": "package main

      import (
      	"fmt"
      	"strings"
      	"net/http"
      	"io"
      )

      func main() {

      	url := "https://api.example.com/v2/scrape"

      	payload := strings.NewReader("{\\n  \\"url\\": \\"https://x.dev/it's\\",\\n  \\"formats\\": [\\n    \\"markdown\\"\\n  ],\\n  \\"onlyMainContent\\": true,\\n  \\"maxAge\\": null,\\n  \\"note\\": \\"cost $5 #{x}\\",\\n  \\"location\\": {\\n    \\"country\\": \\"US\\"\\n  }\\n}")

      	req, _ := http.NewRequest("POST", url, payload)

      	req.Header.Add("Authorization", "Bearer <token>")
      	req.Header.Add("Content-Type", "application/json")

      	res, _ := http.DefaultClient.Do(req)

      	defer res.Body.Close()
      	body, _ := io.ReadAll(res.Body)

      	fmt.Println(string(body))

      }",
        "Java": "HttpResponse<String> response = Unirest.post("https://api.example.com/v2/scrape")
        .header("Authorization", "Bearer <token>")
        .header("Content-Type", "application/json")
        .body("{\\n  \\"url\\": \\"https://x.dev/it's\\",\\n  \\"formats\\": [\\n    \\"markdown\\"\\n  ],\\n  \\"onlyMainContent\\": true,\\n  \\"maxAge\\": null,\\n  \\"note\\": \\"cost $5 #{x}\\",\\n  \\"location\\": {\\n    \\"country\\": \\"US\\"\\n  }\\n}")
        .asString();",
        "JavaScript": "const options = {
        method: "POST",
        headers: {"Authorization":"Bearer <token>","Content-Type":"application/json"},
        body: JSON.stringify({
          "url": "https://x.dev/it's",
          "formats": [
            "markdown"
          ],
          "onlyMainContent": true,
          "maxAge": null,
          "note": "cost $5 #{x}",
          "location": {
            "country": "US"
          }
        })
      };

      fetch("https://api.example.com/v2/scrape", options)
        .then(res => res.json())
        .then(res => console.log(res))
        .catch(err => console.error(err));",
        "PHP": "<?php

      $curl = curl_init();

      curl_setopt_array($curl, [
        CURLOPT_URL => 'https://api.example.com/v2/scrape',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING => "",
        CURLOPT_MAXREDIRS => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_POSTFIELDS => '{
        "url": "https://x.dev/it\\'s",
        "formats": [
          "markdown"
        ],
        "onlyMainContent": true,
        "maxAge": null,
        "note": "cost $5 #{x}",
        "location": {
          "country": "US"
        }
      }',
        CURLOPT_HTTPHEADER => [
          'Authorization: Bearer <token>',
          'Content-Type: application/json'
        ],
      ]);

      $response = curl_exec($curl);
      $err = curl_error($curl);

      curl_close($curl);

      if ($err) {
        echo "cURL Error #:" . $err;
      } else {
        echo $response;
      }",
        "Python": "import requests

      url = "https://api.example.com/v2/scrape"

      payload = {
          "url": "https://x.dev/it's",
          "formats": [
              "markdown"
          ],
          "onlyMainContent": True,
          "maxAge": None,
          "note": "cost $5 #{x}",
          "location": {
              "country": "US"
          }
      }
      headers = {
          "Authorization": "Bearer <token>",
          "Content-Type": "application/json"
      }

      response = requests.post(url, json=payload, headers=headers)

      print(response.text)",
        "Ruby": "require 'uri'
      require 'net/http'

      url = URI("https://api.example.com/v2/scrape")

      http = Net::HTTP.new(url.host, url.port)
      http.use_ssl = true

      request = Net::HTTP::Post.new(url)
      request["Authorization"] = "Bearer <token>"
      request["Content-Type"] = "application/json"
      request.body = "{\\n  \\"url\\": \\"https://x.dev/it's\\",\\n  \\"formats\\": [\\n    \\"markdown\\"\\n  ],\\n  \\"onlyMainContent\\": true,\\n  \\"maxAge\\": null,\\n  \\"note\\": \\"cost $5 \\#{x}\\",\\n  \\"location\\": {\\n    \\"country\\": \\"US\\"\\n  }\\n}"

      response = http.request(request)
      puts response.read_body",
        "cURL": "curl --request POST \\
        --url https://api.example.com/v2/scrape \\
        --header 'Authorization: Bearer <token>' \\
        --header 'Content-Type: application/json' \\
        --data '{"url":"https://x.dev/it'"'"'s","formats":["markdown"],"onlyMainContent":true,"maxAge":null,"note":"cost $5 #{x}","location":{"country":"US"}}'",
      }
    `)
  })

  it('pins a GET with path and query params', () => {
    expect(bySource(get)).toMatchInlineSnapshot(`
      {
        "Go": "package main

      import (
      	"fmt"
      	"net/http"
      	"io"
      )

      func main() {

      	url := "https://api.example.com/v2/monitor/{monitorId}?limit=10&status=ok"

      	req, _ := http.NewRequest("GET", url, nil)

      	req.Header.Add("Authorization", "Bearer <token>")

      	res, _ := http.DefaultClient.Do(req)

      	defer res.Body.Close()
      	body, _ := io.ReadAll(res.Body)

      	fmt.Println(string(body))

      }",
        "Java": "HttpResponse<String> response = Unirest.get("https://api.example.com/v2/monitor/{monitorId}?limit=10&status=ok")
        .header("Authorization", "Bearer <token>")
        .asString();",
        "JavaScript": "const options = {
        method: "GET",
        headers: {"Authorization":"Bearer <token>"}
      };

      fetch("https://api.example.com/v2/monitor/{monitorId}?limit=10&status=ok", options)
        .then(res => res.json())
        .then(res => console.log(res))
        .catch(err => console.error(err));",
        "PHP": "<?php

      $curl = curl_init();

      curl_setopt_array($curl, [
        CURLOPT_URL => 'https://api.example.com/v2/monitor/{monitorId}?limit=10&status=ok',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING => "",
        CURLOPT_MAXREDIRS => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_CUSTOMREQUEST => 'GET',
        CURLOPT_HTTPHEADER => [
          'Authorization: Bearer <token>'
        ],
      ]);

      $response = curl_exec($curl);
      $err = curl_error($curl);

      curl_close($curl);

      if ($err) {
        echo "cURL Error #:" . $err;
      } else {
        echo $response;
      }",
        "Python": "import requests

      url = "https://api.example.com/v2/monitor/{monitorId}?limit=10&status=ok"

      headers = {"Authorization": "Bearer <token>"}

      response = requests.get(url, headers=headers)

      print(response.text)",
        "Ruby": "require 'uri'
      require 'net/http'

      url = URI("https://api.example.com/v2/monitor/{monitorId}?limit=10&status=ok")

      http = Net::HTTP.new(url.host, url.port)
      http.use_ssl = true

      request = Net::HTTP::Get.new(url)
      request["Authorization"] = "Bearer <token>"

      response = http.request(request)
      puts response.read_body",
        "cURL": "curl --request GET \\
        --url 'https://api.example.com/v2/monitor/{monitorId}?limit=10&status=ok' \\
        --header 'Authorization: Bearer <token>'",
      }
    `)
  })

  it('pins a DELETE', () => {
    expect(bySource(del)).toMatchInlineSnapshot(`
      {
        "Go": "package main

      import (
      	"fmt"
      	"net/http"
      	"io"
      )

      func main() {

      	url := "https://api.example.com/v2/monitor/m1"

      	req, _ := http.NewRequest("DELETE", url, nil)

      	req.Header.Add("Authorization", "Bearer <token>")

      	res, _ := http.DefaultClient.Do(req)

      	defer res.Body.Close()
      	body, _ := io.ReadAll(res.Body)

      	fmt.Println(string(body))

      }",
        "Java": "HttpResponse<String> response = Unirest.delete("https://api.example.com/v2/monitor/m1")
        .header("Authorization", "Bearer <token>")
        .asString();",
        "JavaScript": "const options = {
        method: "DELETE",
        headers: {"Authorization":"Bearer <token>"}
      };

      fetch("https://api.example.com/v2/monitor/m1", options)
        .then(res => res.json())
        .then(res => console.log(res))
        .catch(err => console.error(err));",
        "PHP": "<?php

      $curl = curl_init();

      curl_setopt_array($curl, [
        CURLOPT_URL => 'https://api.example.com/v2/monitor/m1',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING => "",
        CURLOPT_MAXREDIRS => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_HTTPHEADER => [
          'Authorization: Bearer <token>'
        ],
      ]);

      $response = curl_exec($curl);
      $err = curl_error($curl);

      curl_close($curl);

      if ($err) {
        echo "cURL Error #:" . $err;
      } else {
        echo $response;
      }",
        "Python": "import requests

      url = "https://api.example.com/v2/monitor/m1"

      headers = {"Authorization": "Bearer <token>"}

      response = requests.delete(url, headers=headers)

      print(response.text)",
        "Ruby": "require 'uri'
      require 'net/http'

      url = URI("https://api.example.com/v2/monitor/m1")

      http = Net::HTTP.new(url.host, url.port)
      http.use_ssl = true

      request = Net::HTTP::Delete.new(url)
      request["Authorization"] = "Bearer <token>"

      response = http.request(request)
      puts response.read_body",
        "cURL": "curl --request DELETE \\
        --url https://api.example.com/v2/monitor/m1 \\
        --header 'Authorization: Bearer <token>'",
      }
    `)
  })

  describe.each([
    ['POST', post],
    ['GET', get],
    ['DELETE', del],
  ])('%s samples are syntactically valid', (_name, request) => {
    const samples = bySource(request)
    it.skipIf(!has('sh', ['-c', 'true']))('cURL', () => {
      expect(check('sh', (f) => ['-n', f], 'sh', samples.cURL).status).toBe(0)
    })
    it.skipIf(!has('python3'))('Python', () => {
      expect(check('python3', (f) => ['-c', `import ast;ast.parse(open(${JSON.stringify(f)}).read())`], 'py', samples.Python).status).toBe(0)
    })
    it.skipIf(!has('node'))('JavaScript', () => {
      expect(check('node', (f) => ['--check', f], 'js', samples.JavaScript).status).toBe(0)
    })
    it.skipIf(!has('ruby'))('Ruby', () => {
      expect(check('ruby', (f) => ['-c', f], 'rb', samples.Ruby).status).toBe(0)
    })
    it.skipIf(!has('gofmt', ['-h']) && !has('gofmt', ['-l', '/dev/null']))('Go', () => {
      const result = check('gofmt', (f) => ['-e', f], 'go', samples.Go)
      expect(result.stderr).toBe('')
    })
    it.skipIf(!has('php'))('PHP', () => {
      expect(check('php', (f) => ['-l', f], 'php', samples.PHP).status).toBe(0)
    })
    it.skipIf(!has('javac', ['-version']))('Java', () => {
      // Unirest is not on the classpath, so only "cannot find symbol" errors are expected;
      // a syntax error would be reported instead of them.
      const result = check('javac', (f) => ['-proc:none', '-d', tmpdir(), f], 'java', `class sample { void f() { ${samples.Java} } }`)
      const errors = (result.stderr.match(/error: .*/g) ?? []).filter((line) => !/cannot find symbol|does not exist/.test(line))
      expect(errors).toEqual([])
    })
  })

  describe('x-codeSamples', () => {
    const spec = (key: string) => ({
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/scrape': {
          post: {
            summary: 'S',
            [key]: [
              { lang: 'python', label: 'Python', source: 'print("authored")' },
              { lang: 'rust', source: 'fn main() {}' },
              { lang: 'bad' },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    })

    it.each(['x-codeSamples', 'x-code-samples'])('reads %s, dropping malformed entries', (key) => {
      expect(operationFrom(spec(key)).codeSamples).toEqual([
        { label: 'Python', source: 'print("authored")' },
        { label: 'rust', source: 'fn main() {}' },
      ])
    })

    it('puts authored samples first and replaces the generated sample for the same language', () => {
      const samples = buildCodeSamples(post, operationFrom(spec('x-codeSamples')).codeSamples)
      expect(samples.map((s) => s.label)).toEqual(['Python', 'rust', 'cURL', 'JavaScript', 'PHP', 'Go', 'Java', 'Ruby'])
      expect(samples[0].source).toBe('print("authored")')
    })

    it('still shows authored samples before a server URL is known', () => {
      expect(buildCodeSamples({ ...post, url: '' }, [{ label: 'Python', source: 'x' }])).toEqual([{ label: 'Python', source: 'x' }])
    })
  })
})
