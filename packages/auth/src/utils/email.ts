export type SendEmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
  from: string;
  text?: string;
  replyTo?: string;
};

export type CloudflareEmailSender = Pick<SendEmail, "send">;

export async function sendCloudflareEmail(
  sender: CloudflareEmailSender,
  options: SendEmailOptions
): Promise<void> {
  await sender.send({
    from: options.from,
    html: options.html,
    ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
    subject: options.subject,
    text: options.text,
    to: options.to,
  });
}
