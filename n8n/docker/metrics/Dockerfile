# The resource logger (see sample.awk). The docker CLI image, because the
# logger needs `docker inspect` to turn a container name into the id its
# kernel counters are filed under, and busybox awk does the rest.
FROM docker:27.5.1-cli
COPY sample.awk /metrics/sample.awk
COPY report.sh /usr/local/bin/report
RUN chmod +x /usr/local/bin/report && mkdir -p /data
ENTRYPOINT ["awk", "-f", "/metrics/sample.awk"]
