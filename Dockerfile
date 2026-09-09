FROM nginx:alpine

COPY fronted /usr/share/nginx/html

EXPOSE 80
