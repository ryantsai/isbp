{{/* ───────────────────────────── names ───────────────────────────── */}}

{{/* Chart name. */}}
{{- define "isbp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Fully qualified app name (release-based); "isbp" for a release named isbp. */}}
{{- define "isbp.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* <fullname>-<component>, e.g. isbp-api. Usage: include "isbp.componentName" (dict "root" $ "component" "api") */}}
{{- define "isbp.componentName" -}}
{{- printf "%s-%s" (include "isbp.fullname" .root) .component | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "isbp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Version reported in labels: the shared image tag, else the chart appVersion. */}}
{{- define "isbp.appVersion" -}}
{{- .Values.image.tag | default .Chart.AppVersion | toString | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* ───────────────────────────── labels ───────────────────────────── */}}

{{- define "isbp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "isbp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "isbp.labels" -}}
helm.sh/chart: {{ include "isbp.chart" . }}
{{ include "isbp.selectorLabels" . }}
app.kubernetes.io/version: {{ include "isbp.appVersion" . | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: isbp
{{- end }}

{{/* Usage: include "isbp.componentSelectorLabels" (dict "root" $ "component" "api") */}}
{{- define "isbp.componentSelectorLabels" -}}
{{ include "isbp.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "isbp.componentLabels" -}}
{{ include "isbp.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* ───────────────────────────── images ───────────────────────────── */}}

{{/* Usage: include "isbp.image" (dict "root" $ "image" .Values.api.image) — digest wins over tag. */}}
{{- define "isbp.image" -}}
{{- $repo := required "image.repository is required" .image.repository -}}
{{- if .image.digest -}}
{{- printf "%s@%s" $repo .image.digest -}}
{{- else -}}
{{- $tag := .image.tag | default .root.Values.image.tag | default .root.Chart.AppVersion -}}
{{- printf "%s:%s" $repo (toString $tag) -}}
{{- end -}}
{{- end }}

{{- define "isbp.imagePullPolicy" -}}
{{- .image.pullPolicy | default .root.Values.image.pullPolicy | default "IfNotPresent" -}}
{{- end }}

{{/* ───────────────────────────── accounts & secrets ───────────────────────────── */}}

{{- define "isbp.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- .Values.serviceAccount.name | default (include "isbp.fullname" .) -}}
{{- else -}}
{{- .Values.serviceAccount.name | default "default" -}}
{{- end -}}
{{- end }}

{{/* Secret consumed by api/worker (envFrom). Validates secrets.mode. */}}
{{- define "isbp.secretName" -}}
{{- $mode := .Values.secrets.mode -}}
{{- if eq $mode "existing" -}}
{{- required "secrets.existingSecret is required when secrets.mode=existing" .Values.secrets.existingSecret -}}
{{- else if eq $mode "external" -}}
{{- .Values.secrets.external.targetName | default (printf "%s-secrets" (include "isbp.fullname" .)) -}}
{{- else if eq $mode "create" -}}
{{- printf "%s-secrets" (include "isbp.fullname" .) -}}
{{- else -}}
{{- fail (printf "secrets.mode must be one of: create, existing, external (got %q)" (toString $mode)) -}}
{{- end -}}
{{- end }}

{{/*
Secret consumed by the migrations hook Job. Hooks run before the release's regular resources are
created/updated, so for mode=create/external the Job gets its own hook-scoped copy; an existing Secret is
used directly.
*/}}
{{- define "isbp.migrationSecretName" -}}
{{- if eq .Values.secrets.mode "existing" -}}
{{- include "isbp.secretName" . -}}
{{- else -}}
{{- printf "%s-migrate" (include "isbp.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end }}

{{/* `data:` body of a chart-managed Secret (secrets.mode=create). */}}
{{- define "isbp.secretData" -}}
{{- $v := .Values.secrets.values -}}
{{- $key := required "secrets.values.ISBP_MASTER_KEY is required when secrets.mode=create (generate one with: openssl rand -base64 32)" $v.ISBP_MASTER_KEY -}}
{{- if ne (len (b64dec $key)) 32 -}}
{{- fail "secrets.values.ISBP_MASTER_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)" -}}
{{- end -}}
DATABASE_URL: {{ required "secrets.values.DATABASE_URL is required when secrets.mode=create" $v.DATABASE_URL | b64enc | quote }}
REDIS_URL: {{ required "secrets.values.REDIS_URL is required when secrets.mode=create" $v.REDIS_URL | b64enc | quote }}
ISBP_MASTER_KEY: {{ $key | b64enc | quote }}
{{- range $k, $val := $v }}
{{- if and (not (has $k (list "DATABASE_URL" "REDIS_URL" "ISBP_MASTER_KEY"))) (not (kindIs "invalid" $val)) }}
{{- if ne (toString $val) "" }}
{{ $k }}: {{ toString $val | b64enc | quote }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/* `spec:` body of an ExternalSecret. Usage: include "isbp.externalSecretSpec" (dict "root" $ "target" "name") */}}
{{- define "isbp.externalSecretSpec" -}}
{{- $ext := .root.Values.secrets.external -}}
{{- if not (or $ext.data $ext.dataFrom) -}}
{{- fail "secrets.external.data or secrets.external.dataFrom must be set when secrets.mode=external" -}}
{{- end -}}
refreshInterval: {{ $ext.refreshInterval | default "1h" | quote }}
secretStoreRef:
  kind: {{ $ext.secretStoreRef.kind | default "ClusterSecretStore" }}
  name: {{ required "secrets.external.secretStoreRef.name is required when secrets.mode=external" $ext.secretStoreRef.name }}
target:
  name: {{ .target }}
  creationPolicy: Owner
  {{- with $ext.template }}
  template:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- with $ext.data }}
data:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $ext.dataFrom }}
dataFrom:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/* ───────────────────────────── configuration ───────────────────────────── */}}

{{/* Public origin: config.PUBLIC_URL, else derived from the ingress. */}}
{{- define "isbp.publicUrl" -}}
{{- if .Values.config.PUBLIC_URL -}}
{{- .Values.config.PUBLIC_URL -}}
{{- else if .Values.ingress.enabled -}}
{{- $scheme := "http" -}}
{{- if .Values.ingress.tls.enabled -}}
{{- $scheme = "https" -}}
{{- end -}}
{{- printf "%s://%s" $scheme (required "ingress.host is required" .Values.ingress.host) -}}
{{- else -}}
{{- fail "config.PUBLIC_URL is required when ingress.enabled=false (e.g. https://isbp.example.com)" -}}
{{- end -}}
{{- end }}

{{/* Non-secret env for api/worker/migrations as a YAML map (ConfigMap data, and inline env for the hook Job). */}}
{{- define "isbp.apiConfig" -}}
{{- $cfg := dict -}}
{{- range $k, $v := .Values.config -}}
{{- if not (kindIs "invalid" $v) -}}
{{- if ne (toString $v) "" -}}
{{- $_ := set $cfg $k (toString $v) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $_ := set $cfg "NODE_ENV" "production" -}}
{{- $_ := set $cfg "PUBLIC_URL" (include "isbp.publicUrl" .) -}}
{{- $files := .Values.files -}}
{{- $_ := set $cfg "FILES_STORAGE" $files.storage -}}
{{- if eq $files.storage "s3" -}}
{{- $_ := set $cfg "S3_BUCKET" (required "files.s3.bucket is required when files.storage=s3" $files.s3.bucket) -}}
{{- $_ := set $cfg "S3_REGION" $files.s3.region -}}
{{- $_ := set $cfg "S3_PREFIX" $files.s3.prefix -}}
{{- $_ := set $cfg "S3_FORCE_PATH_STYLE" (toString $files.s3.forcePathStyle) -}}
{{- with $files.s3.endpoint }}{{ $_ := set $cfg "S3_ENDPOINT" . }}{{ end -}}
{{- with $files.s3.sse }}{{ $_ := set $cfg "S3_SSE" . }}{{ end -}}
{{- else if eq $files.storage "local" -}}
{{- $_ := set $cfg "FILES_DIR" "/var/lib/isbp/files" -}}
{{- else -}}
{{- fail "files.storage must be local or s3" -}}
{{- end -}}
{{- with $files.clamav.host }}
{{- $_ := set $cfg "CLAMAV_HOST" . -}}
{{- $_ := set $cfg "CLAMAV_PORT" (toString $files.clamav.port) -}}
{{- end -}}
{{- toYaml $cfg -}}
{{- end }}

{{/* The attachments volume (files.storage=local) for api and worker pods. */}}
{{- define "isbp.filesVolumeMount" -}}
{{- if eq .Values.files.storage "local" }}
- name: files
  mountPath: /var/lib/isbp/files
{{- end }}
{{- end }}

{{- define "isbp.filesVolume" -}}
{{- if eq .Values.files.storage "local" }}
- name: files
  persistentVolumeClaim:
    claimName: {{ .Values.files.persistence.existingClaim | default (printf "%s-files" (include "isbp.fullname" .)) }}
{{- end }}
{{- end }}

{{/* Renders a {name: value} map as an EnvVar list. Usage: include "isbp.envMap" .Values.api.env */}}
{{- define "isbp.envMap" -}}
{{- range $k, $v := . }}
- name: {{ $k }}
  value: {{ toString $v | quote }}
{{- end }}
{{- end }}

{{/* ───────────────────────────── pod spec ───────────────────────────── */}}

{{/*
Pod-level settings shared by the Deployments.
Usage: include "isbp.podSpecCommon" (dict "root" $ "component" "api" "values" .Values.api)
*/}}
{{- define "isbp.podSpecCommon" -}}
{{- $root := .root -}}
{{- $c := .values -}}
serviceAccountName: {{ include "isbp.serviceAccountName" $root }}
automountServiceAccountToken: {{ $root.Values.serviceAccount.automountServiceAccountToken }}
{{- with $root.Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
securityContext:
  {{- toYaml $root.Values.podSecurityContext | nindent 2 }}
{{- with $c.terminationGracePeriodSeconds }}
terminationGracePeriodSeconds: {{ . }}
{{- end }}
{{- with $c.priorityClassName }}
priorityClassName: {{ . }}
{{- end }}
{{- with $c.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $c.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $c.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- if $c.topologySpreadConstraints }}
topologySpreadConstraints:
  {{- toYaml $c.topologySpreadConstraints | nindent 2 }}
{{- else if $root.Values.defaultTopologySpread }}
topologySpreadConstraints:
  {{- range $key := list "topology.kubernetes.io/zone" "kubernetes.io/hostname" }}
  - maxSkew: 1
    topologyKey: {{ $key }}
    whenUnsatisfiable: ScheduleAnyway
    matchLabelKeys:
      - pod-template-hash
    labelSelector:
      matchLabels:
        {{- include "isbp.componentSelectorLabels" (dict "root" $root "component" $.component) | nindent 8 }}
  {{- end }}
{{- end }}
{{- end }}

{{/* Pod annotations that roll pods when configuration changes. */}}
{{- define "isbp.checksumAnnotations" -}}
checksum/config: {{ include (print .Template.BasePath "/configmap.yaml") . | sha256sum }}
checksum/secret: {{ include (print .Template.BasePath "/secret.yaml") . | sha256sum }}
{{- end }}

{{/*
Container fields (after name/image/command) shared by the migrate and seed containers of the hook Job.
Usage: include "isbp.migrateContainerBody" (dict "root" $ "service" "isbp-migrate")
*/}}
{{- define "isbp.migrateContainerBody" -}}
{{- $root := .root -}}
{{- $m := $root.Values.migrations -}}
env:
  {{- range $k, $v := (include "isbp.apiConfig" $root | fromYaml) }}
  - name: {{ $k }}
    value: {{ toString $v | quote }}
  {{- end }}
  - name: OTEL_SERVICE_NAME
    value: {{ .service }}
  {{- with $m.env }}
  {{- include "isbp.envMap" . | trim | nindent 2 }}
  {{- end }}
  {{- with $m.extraEnv }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
envFrom:
  - secretRef:
      name: {{ include "isbp.migrationSecretName" $root }}
resources:
  {{- toYaml $m.resources | nindent 2 }}
securityContext:
  {{- toYaml $root.Values.securityContext | nindent 2 }}
volumeMounts:
  - name: tmp
    mountPath: /tmp
{{- end }}
