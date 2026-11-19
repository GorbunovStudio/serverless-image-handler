FROM public.ecr.aws/lambda/nodejs:24

RUN dnf install -y zip && dnf clean all

WORKDIR /home/app/deployment

ENTRYPOINT ["./build-s3-dist.sh"]
