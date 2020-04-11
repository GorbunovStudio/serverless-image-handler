FROM amazonlinux:latest

RUN yum install -y zip tar gzip make gcc-c++

RUN touch ~/.bashrc && chmod +x ~/.bashrc

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
RUN source ~/.bashrc && nvm install v12

RUN echo "#!/bin/bash" > /start.sh \
    && echo "source /root/.bashrc" >> /start.sh \
    && echo '/home/app/deployment/build-s3-dist.sh "$@"' >> /start.sh \
    && chmod +x /start.sh
    
WORKDIR /home/app/deployment

ENTRYPOINT ["/start.sh"]
